#!/usr/bin/env node
import "@decisionloop/runtime/env";
const { main } = await import("./main");
void main(process.argv.slice(2));
