#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = __dirname;
const COMMANDS_DIR = path.join(PLUGIN_ROOT, "commands");
const SKILLS_DIR = path.join(PLUGIN_ROOT, "skills");
const HOOKS_DIR = path.join(PLUGIN_ROOT, "hooks");

const server = new Server(
  {
    name: "gru953-studio-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      prompts: {},
      resources: {},
      tools: {},
    },
  }
);

// Helpers
async function getCommands() {
  try {
    const files = await fs.readdir(COMMANDS_DIR);
    return files.filter(f => f.endsWith(".md"));
  } catch {
    return [];
  }
}

async function getSkills() {
  try {
    const files = await fs.readdir(SKILLS_DIR);
    const skills = [];
    for (const f of files) {
      const stat = await fs.stat(path.join(SKILLS_DIR, f));
      if (stat.isDirectory()) {
        skills.push(f);
      }
    }
    return skills;
  } catch {
    return [];
  }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const lines = m[1].split("\n");
  const result = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"](.*)['"]$/, "$1");
    }
  }
  return result;
}

// 1. Prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  const commands = await getCommands();
  const prompts = [];
  for (const file of commands) {
    const text = await fs.readFile(path.join(COMMANDS_DIR, file), "utf-8");
    const meta = parseFrontmatter(text);
    prompts.push({
      name: file.replace(".md", ""),
      description: meta.description || `Execute the ${file} command`,
      arguments: meta["argument-hint"] ? [
        {
          name: "args",
          description: meta["argument-hint"],
          required: false
        }
      ] : []
    });
  }
  return { prompts };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const commands = await getCommands();
  const file = request.params.name + ".md";
  if (!commands.includes(file)) {
    throw new Error(`Prompt not found: ${request.params.name}`);
  }
  
  let text = await fs.readFile(path.join(COMMANDS_DIR, file), "utf-8");
  // Replace references to running bash scripts with calling tools
  text += "\n\nNote: If these instructions tell you to run `node \"${CLAUDE_PLUGIN_ROOT}/hooks/something.mjs\"`, use the corresponding MCP tool instead (e.g. `studio_generate_dashboard`, `studio_session_start`, etc).";
  
  const argsText = request.params.arguments?.args ? `\n\nArguments provided: ${request.params.arguments.args}` : "";
  
  return {
    description: `Instructions for ${request.params.name}`,
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: text + argsText
        }
      }
    ]
  };
});

// 2. Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const skills = await getSkills();
  const resources = [];
  for (const skill of skills) {
    const text = await fs.readFile(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf-8").catch(() => "");
    const meta = parseFrontmatter(text);
    resources.push({
      uri: `studio://skill/${skill}`,
      name: `Skill: ${meta.name || skill}`,
      description: meta.description || `Documentation for the ${skill} skill`,
      mimeType: "text/markdown"
    });
  }
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (!uri.startsWith("studio://skill/")) {
    throw new Error(`Invalid URI scheme: ${uri}`);
  }
  const skill = uri.replace("studio://skill/", "");
  const skills = await getSkills();
  if (!skills.includes(skill)) {
    throw new Error(`Skill not found: ${skill}`);
  }
  
  const text = await fs.readFile(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf-8");
  
  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text
      }
    ]
  };
});

// 3. Tools
const TOOLS = [
  {
    name: "studio_generate_dashboard",
    description: "Generates the GRU953-Studio HTML dashboard. Run this when asked to show the dashboard.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "studio_run_quality_gate",
    description: "Runs the project's quality gate checks.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "studio_security_scan",
    description: "Runs secret and publish-safety scans.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "studio_licence_scan",
    description: "Scans project dependencies for license compliance.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "studio_traceability_check",
    description: "Verifies traceability of tasks to requirements.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "studio_session_start",
    description: "Initializes a new development session.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "studio_content_check",
    description: "Verifies asset/content integrity.",
    inputSchema: { type: "object", properties: {} }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const scriptMap = {
    "studio_generate_dashboard": "dashboard.mjs",
    "studio_run_quality_gate": "quality-gate.mjs",
    "studio_security_scan": "scan.mjs", // could chain gate.mjs as well
    "studio_licence_scan": "licence-scan.mjs",
    "studio_traceability_check": "traceability-check.mjs",
    "studio_session_start": "session-start.mjs",
    "studio_content_check": "content-check.mjs"
  };

  const script = scriptMap[request.params.name];
  if (!script) {
    throw new Error(`Tool not found: ${request.params.name}`);
  }

  const scriptPath = path.join(HOOKS_DIR, script);
  
  return new Promise((resolve, reject) => {
    const cwd = process.cwd(); // MCP clients typically set this to project root
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
    
    // Most scripts take '.' or CWD as an argument
    const child = spawn("node", [scriptPath, cwd], { cwd, env });
    
    let stdout = "";
    let stderr = "";
    
    child.stdout.on("data", (data) => stdout += data.toString());
    child.stderr.on("data", (data) => stderr += data.toString());
    
    child.on("close", (code) => {
      resolve({
        content: [
          {
            type: "text",
            text: `Exit Code: ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
          }
        ],
        isError: code !== 0,
      });
    });
    
    child.on("error", (err) => {
      resolve({
        content: [
          {
            type: "text",
            text: `Failed to spawn: ${err.message}`
          }
        ],
        isError: true
      });
    });
  });
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("GRU953-Studio MCP Server running on stdio");
