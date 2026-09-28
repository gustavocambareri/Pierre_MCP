#!/usr/bin/env node
/**
 * Pierre MCP server.
 *
 * Gives Claude access to a design team's accumulated knowledge: conventions,
 * decisions, and patterns stored as Markdown. Designers install it once and
 * Claude reads from — and writes back to — the shared store as they work.
 *
 * Transport is stdio, so the client launches this process directly.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  knowledgeRoot,
  loadAll,
  readDoc,
  writeDoc,
  search,
  excerpt,
} from "./knowledge.mjs";

const server = new McpServer({ name: "pierre", version: "1.0.0" });

const text = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (s) => ({ content: [{ type: "text", text: s }], isError: true });

/**
 * Recall. The description is prescriptive about WHEN to call it, not just what
 * it does — a designer will never remember to ask for context by hand, so this
 * has to fire on its own at the start of design work.
 */
server.registerTool(
  "search_knowledge",
  {
    title: "Search team knowledge",
    description:
      "Search this design team's accumulated conventions, decisions, and patterns. " +
      "Call this BEFORE answering any question about how the team designs or builds: " +
      "spacing, type scales, colour, naming, component structure, motion, accessibility, " +
      "file organisation, or 'how do we usually do X'. Also call it before proposing a " +
      "new component, reviewing a design, or writing UI code, so your answer matches " +
      "decisions the team already made. Searching costs little; answering from generic " +
      "knowledge when the team has a documented convention is the failure to avoid.",
    inputSchema: {
      query: z
        .string()
        .describe("What to look for, e.g. 'mobile spacing' or 'button variants'."),
      project: z
        .string()
        .optional()
        .describe("Restrict to one project/engagement slug."),
    },
  },
  async ({ query, project }) => {
    const hits = await search(query, { project });
    if (!hits.length) {
      return text(
        `No team knowledge found for "${query}". Answer from general knowledge, ` +
          `and consider recording the decision with record_decision once made.`,
      );
    }
    const body = hits
      .map(
        (d) =>
          `## ${d.title}\n` +
          `id: ${d.id}${d.project ? ` · project: ${d.project}` : ""} · author: ${d.author}\n\n` +
          `${excerpt(d, query)}`,
      )
      .join("\n\n---\n\n");
    return text(
      `${hits.length} result(s). Use get_document for the full text.\n\n${body}`,
    );
  },
);

server.registerTool(
  "get_document",
  {
    title: "Read a knowledge document",
    description:
      "Read one document in full by its id. Use after search_knowledge when an " +
      "excerpt looks relevant and you need the complete rule, table, or rationale " +
      "before acting on it.",
    inputSchema: {
      id: z.string().describe("Document id, e.g. 'team/spacing' or 'atlas/blocks'."),
    },
  },
  async ({ id }) => {
    try {
      const doc = await readDoc(id);
      return text(`# ${doc.title ?? id}\n\n${doc.body}`);
    } catch (err) {
      return fail(
        `Could not read "${id}": ${err.message}. Use list_documents to see valid ids.`,
      );
    }
  },
);

/**
 * Capture. Writing has to be one cheap call with no ceremony, or nobody does
 * it and the store never grows.
 */
server.registerTool(
  "record_decision",
  {
    title: "Record a team decision",
    description:
      "Save a design decision, convention, or pattern so the team and future " +
      "sessions inherit it. Call this whenever the user settles a question that " +
      "will apply again later — a spacing rule, a naming convention, a component " +
      "API, a rejected approach and why. Prefer recording at the moment the " +
      "decision is made rather than at the end of a session. Reuse an existing " +
      "id to update a decision that has changed.",
    inputSchema: {
      id: z
        .string()
        .describe("Path-like id, e.g. 'team/spacing' or 'atlas/card-anatomy'."),
      title: z.string().describe("Short human-readable title."),
      body: z
        .string()
        .describe(
          "The decision in Markdown. Include the reasoning — a decision without " +
            "its rationale gets relitigated.",
        ),
      project: z.string().optional().describe("Project slug, if project-specific."),
      author: z.string().optional().describe("Who made the call. Defaults to 'team'."),
      tags: z.array(z.string()).optional().describe("Keywords to aid retrieval."),
    },
  },
  async (args) => {
    try {
      const { id, created } = await writeDoc(args);
      return text(`Recorded "${args.title}" as ${id} (created ${created}).`);
    } catch (err) {
      return fail(`Could not record decision: ${err.message}`);
    }
  },
);

server.registerTool(
  "list_documents",
  {
    title: "List knowledge documents",
    description:
      "List every document in the team's knowledge store with its id, title, and " +
      "project. Use to get an overview of what the team has documented, or to find " +
      "a valid id when a search excerpt was ambiguous.",
    inputSchema: {
      project: z.string().optional().describe("Restrict to one project slug."),
    },
  },
  async ({ project }) => {
    const docs = (await loadAll()).filter((d) => !project || d.project === project);
    if (!docs.length) {
      return text(
        `No documents in ${knowledgeRoot()}. Record the team's first decision ` +
          `with record_decision.`,
      );
    }
    const lines = docs
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => `- ${d.id} — ${d.title}${d.project ? ` (${d.project})` : ""}`);
    return text(`${docs.length} document(s) in ${knowledgeRoot()}:\n\n${lines.join("\n")}`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
