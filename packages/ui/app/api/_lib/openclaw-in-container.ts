/**
 * Run OpenClaw Gateway RPC from inside a container so the gateway sees localhost
 * (no port-forward or allowInsecureAuth needed). Used when the gateway runs in a
 * sandbox (e.g. create_sandbox with OpenClaw image).
 *
 * Cross-platform: the container is always Linux; the host may be Windows, macOS, or Linux.
 * Exec (podman/docker exec) is supported on all platforms; if the runtime reports an error
 * (e.g. "container state improper"), the handler and e2e return a clear error or skip.
 */

const GATEWAY_PORT = 18788;
const PROTOCOL_VERSION = 3;
const CONNECT_FALLBACK_MS = 5000;
const RPC_TIMEOUT_MS = 60000;

/** Path in container where we install ws (create_sandbox for OpenClaw runs prepareWsStep). */
export const OPENCLAW_CONTAINER_WS_PATH = "/tmp/oc-client/node_modules";

/** Minimal script run inside the container: read token from config, connect to ws://127.0.0.1:PORT as Control UI (token only), send one RPC, print payload JSON. */
function getInContainerScript(): string {
  return [
    "const fs=require('fs');",
    "const rpc=JSON.parse(Buffer.from(process.env.OPENCLAW_RPC_B64||'','base64').toString());",
    "const paths=['/root/.openclaw/openclaw.json','/home/node/.openclaw/openclaw.json'];",
    "let token;",
    "for(const p of paths){try{const c=JSON.parse(fs.readFileSync(p,'utf8'));token=c.gateway&&c.gateway.auth&&c.gateway.auth.token;if(token)break;}catch(e){}}",
    "const connectParams={minProtocol:" +
      PROTOCOL_VERSION +
      ",maxProtocol:" +
      PROTOCOL_VERSION +
      ",client:{id:'openclaw-control-ui',version:'0.1',platform:'node',mode:'ui'},role:'operator',scopes:['operator.admin','operator.read','operator.write'],caps:[],commands:[],permissions:{},locale:'en-US',userAgent:'agentron-studio/0.1'};",
    "if(token)connectParams.auth={token};",
    "const wsPath=process.env.OPENCLAW_WS_PATH||'/tmp/oc-client/node_modules';",
    "const Ws=typeof globalThis!=='undefined'&&globalThis.WebSocket?globalThis.WebSocket:(function(){try{return require(wsPath+'/ws');}catch(e){return null;}})();",
    "if(!Ws){console.error(JSON.stringify({error:'No WebSocket (set OPENCLAW_WS_PATH or use Node 22+)'}));process.exit(1);}",
    "const ws=new Ws('ws://127.0.0.1:" +
      GATEWAY_PORT +
      "',{handshakeTimeout:8000,headers:{Origin:'http://127.0.0.1:" +
      GATEWAY_PORT +
      "'}});",
    "const connectId='agentron-'+Date.now();",
    "const reqId='agentron-rpc-'+Date.now();",
    "let connectSent=false;",
    "let rpcSent=false;",
    "const sendConnect=()=>{if(connectSent||ws.readyState!==1)return;connectSent=true;ws.send(JSON.stringify({type:'req',id:connectId,method:'connect',params:connectParams}));};",
    "const sendRpc=()=>{if(rpcSent)return;rpcSent=true;ws.send(JSON.stringify({type:'req',id:reqId,method:rpc.method,params:rpc.params||{}}));};",
    "const t=setTimeout(()=>{try{ws.terminate();}catch(e){}process.exit(1);}," +
      RPC_TIMEOUT_MS +
      ");",
    "const on=(ev,fn)=>{if(typeof ws.addEventListener==='function')ws.addEventListener(ev,fn);else ws.on(ev,fn);};",
    "on('open',()=>setTimeout(sendConnect," + CONNECT_FALLBACK_MS + "));",
    "on('error',e=>{clearTimeout(t);console.error(JSON.stringify({error:(e&&e.message)||String(e)}));process.exit(1);});",
    "on('message',d=>{try{const raw=d&&(d.data!==undefined?d.data:d);const m=JSON.parse(raw.toString());if(m.type==='event'&&m.event==='connect.challenge')sendConnect();if(m.type==='res'&&m.id===connectId&&m.ok)sendRpc();if(m.type==='res'&&m.id===reqId){clearTimeout(t);ws.close();if(m.ok)console.log(JSON.stringify(m.payload!==undefined?m.payload:null));else console.error(JSON.stringify({error:m.error&&m.error.message||'RPC failed'}));process.exit(m.ok?0:1);}}catch(e){}});",
  ].join("");
}

export type ExecFn = (
  containerId: string,
  command: string
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * Run a single OpenClaw RPC (e.g. chat.send, chat.history) inside the container.
 * Connection is to 127.0.0.1 so the gateway treats it as localhost.
 */
export async function runOpenclawRpcInContainer(
  containerId: string,
  method: string,
  params: Record<string, unknown>,
  exec: ExecFn
): Promise<{ payload: unknown; error?: string }> {
  const rpcB64 = Buffer.from(JSON.stringify({ method, params }), "utf8").toString("base64");
  const scriptB64 = Buffer.from(getInContainerScript(), "utf8").toString("base64");
  // Use single-quoted node -e so sh -c does not break on inner "; escape ' as '\'' for sh.
  const nodeCode = "eval(Buffer.from(process.env.SCRIPT_B64,'base64').toString())";
  const command = `OPENCLAW_WS_PATH=${OPENCLAW_CONTAINER_WS_PATH} OPENCLAW_RPC_B64=${rpcB64} SCRIPT_B64=${scriptB64} node -e '${nodeCode.replace(/'/g, "'\\''")}'`;
  const { stdout, stderr, exitCode } = await exec(containerId, command);
  if (exitCode !== 0) {
    const errMsg = stderr?.trim() || stdout?.trim() || "Non-zero exit";
    try {
      const parsed = JSON.parse(errMsg) as { error?: string };
      return { payload: undefined, error: parsed.error ?? errMsg };
    } catch {
      return { payload: undefined, error: errMsg };
    }
  }
  try {
    const payload = JSON.parse(stdout.trim()) as unknown;
    return { payload };
  } catch {
    return {
      payload: undefined,
      error: "Invalid JSON from container: " + (stdout || stderr).slice(0, 200),
    };
  }
}
