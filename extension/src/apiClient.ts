import * as http from 'http';
import { logger } from './logger';

export class ApiClient {
  private baseUrl: string;

  constructor(port: number, host: string = '127.0.0.1') {
    this.baseUrl = `http://${host}:${port}`;
    logger.info(`ApiClient initialized: ${this.baseUrl}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    logger.debug(`API ${method} ${path}`);

    return new Promise<T>((resolve, reject) => {
      const url = new URL(path, this.baseUrl);

      const options: http.RequestOptions = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed as T);
            }
          } catch {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        logger.error(`API request failed: ${err.message}`);
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('GET', '/api/health');
      return true;
    } catch {
      return false;
    }
  }

  async searchFunctions(query: string, limit = 50): Promise<FunctionInfo[]> {
    return this.request('GET', `/api/search/functions?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getFunctionInfo(usr: string): Promise<FunctionDetail> {
    return this.request('GET', `/api/functions/${encodeURIComponent(usr)}`);
  }

  async getForwardCallGraph(usr: string, depth = 2): Promise<CallGraphResponse> {
    return this.request('GET', `/api/callgraph/forward/${encodeURIComponent(usr)}?depth=${depth}`);
  }

  async getBackwardCallGraph(usr: string, depth = 2): Promise<CallGraphResponse> {
    return this.request('GET', `/api/callgraph/backward/${encodeURIComponent(usr)}?depth=${depth}`);
  }

  async findPath(fromUsr: string, toUsr: string): Promise<CallGraphResponse> {
    return this.request('GET', `/api/callgraph/path?from=${encodeURIComponent(fromUsr)}&to=${encodeURIComponent(toUsr)}`);
  }

  async searchVariables(query: string, limit = 50): Promise<GlobalVarInfo[]> {
    return this.request('GET', `/api/search/variables?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getVariableInfo(usr: string): Promise<GlobalVarInfo> {
    return this.request('GET', `/api/variables/${encodeURIComponent(usr)}`);
  }

  async getVariableAccesses(varUsr: string, funcUsr?: string): Promise<AccessInfo[]> {
    let url = `/api/variables/${encodeURIComponent(varUsr)}/accesses`;
    if (funcUsr) url += `?function_usr=${encodeURIComponent(funcUsr)}`;
    return this.request('GET', url);
  }

  async getVariableDataFlow(varUsr: string, depth = 3): Promise<DataFlowResponse> {
    return this.request('GET', `/api/dataflow/variable/${encodeURIComponent(varUsr)}?depth=${depth}`);
  }

  async startParse(): Promise<{ status: string; message: string }> {
    return this.request('POST', '/api/parse');
  }

  async cancelParse(): Promise<{ cancelled: boolean }> {
    return this.request('POST', '/api/parse/cancel');
  }

  async getParseStatus(): Promise<{ parsing: boolean }> {
    return this.request('GET', '/api/parse/status');
  }

  async getStats(): Promise<Record<string, number>> {
    return this.request('GET', '/api/stats');
  }

  async updateConfig(config: Record<string, unknown>): Promise<void> {
    await this.request('POST', '/api/config', config);
  }
}

// Type definitions matching protobuf
export interface FunctionInfo {
  usr: string;
  name: string;
  file: string;
  line: number;
  column: number;
  module: string;
  signature: string;
  modifies?: string[];
  references?: string[];
}

export interface FunctionDetail extends FunctionInfo {
  callers: CallEdge[];
  callees: CallEdge[];
}

export interface CallEdge {
  caller_usr: string;
  callee_usr: string;
  call_file: string;
  call_line: number;
  call_column: number;
}

export interface GlobalVarInfo {
  usr: string;
  name: string;
  file: string;
  line: number;
  type: string;
  is_extern: boolean;
  module: string;
}

export interface AccessInfo {
  var_usr: string;
  function_usr: string;
  is_write: boolean;
  access_file: string;
  access_line: number;
  access_column: number;
}

export interface CallGraphResponse {
  nodes: FunctionInfo[];
  edges: CallEdge[];
}

export interface DataFlowEdge {
  from_usr: string;
  to_usr: string;
  var_usr: string;
  type: string;
}

export interface DataFlowResponse {
  function_nodes: FunctionInfo[];
  variable_nodes: GlobalVarInfo[];
  edges: DataFlowEdge[];
}
