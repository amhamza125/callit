// Deploy CallIt to Vercel via the MCP CLI (DepositCourt pattern). Atlas
// runs this — it is never run by the dApp build.
//
// The CLI takes arguments as ONE argv string (OS cap ~128KB), so file
// bodies can never travel inline for anything sizeable: every source
// file is uploaded individually by SHA-1 (each is a few KB), then the
// deployment references { file, sha, size } and Vercel builds from
// package.json. package-lock.json is the one file too large even for
// its own upload call; it is omitted — genlayer-js is pinned exactly
// in package.json and the rest are stable ranges.
//
// Required env (the CallIt Vercel project must exist first):
//   VERCEL_TEAM_ID     e.g. team_...
//   VERCEL_PROJECT_ID  e.g. prj_...
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const TEAM = process.env.VERCEL_TEAM_ID;
const PROJECT = process.env.VERCEL_PROJECT_ID;
if (!TEAM || !PROJECT) {
  console.error("Set VERCEL_TEAM_ID and VERCEL_PROJECT_ID for the CallIt Vercel project first.");
  process.exit(1);
}
const ROOT = new URL(".", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", "dist", "shots"]);
const SKIP_FILES = new Set(["package-lock.json", "deploy.mjs", "verify-live.mjs", "BUILD.md"]);

function callTool(name, args) {
  const out = execFileSync("/opt/hatch/bin/vercel", ["call-tool", "--name", name, "--arguments-json", JSON.stringify(args)], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const parsed = JSON.parse(out);
  if (!parsed.ok) throw new Error(`${name} failed: ${out.slice(0, 400)}`);
  const text = parsed.result?.content?.[0]?.text;
  return text ? JSON.parse(text).result : parsed.result;
}

function collect(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else out.push(relative(ROOT, p));
  }
  return out;
}

const files = collect(ROOT);
const refs = [];
for (const rel of files) {
  const buf = readFileSync(join(ROOT, rel));
  const sha = createHash("sha1").update(buf).digest("hex");
  callTool("upload_file", { teamId: TEAM, xVercelDigest: sha, contentLength: buf.length, requestBody: buf.toString("base64") });
  refs.push({ file: rel, sha, size: buf.length });
  console.log(`uploaded ${rel} (${buf.length} B)`);
}

const deployment = callTool("create_deployment", {
  teamId: TEAM,
  forceNew: "1",
  requestBody: {
    name: "callit",
    project: PROJECT,
    files: refs,
    target: "production",
    projectSettings: {
      framework: "vite",
      buildCommand: "npm run build",
      installCommand: "npm install",
      outputDirectory: "dist",
    },
  },
});
console.log(JSON.stringify(deployment, null, 1).slice(0, 1500));
