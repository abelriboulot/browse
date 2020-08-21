#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const yargs = require("yargs");

const { argv } = yargs
  .alias("v", "version")
  .completion("completion", "Generate a completion script for bash or zsh")
  .command("$0 [script]", "Run browse", (yargs) => {
    yargs.option("web", {
      type: "boolean",
      description: "Add web-scraping rules to the global context",
    });
  })
  .help("h")
  .alias("h", "help");
const { script } = argv;

if (script === "completion") {
  yargs.showCompletionScript();
  process.exit(0);
}

const parser = require("@browselang/parser");
const {
  evalRule,
  getNewScope,
  evalRuleSet,
  stringify,
  stringifyError,
} = require("@browselang/core");

let scope = getNewScope();
if (argv.web) {
  scope = require("@browselang/web")(scope);
}

async function closeAllScopes() {
  let c = scope;
  while (c) {
    await c.close();
    c = c.parent;
  }
}

const genUnknownParseError = () =>
  new Error(
    "Browse encountered an error while parsing your script but was unable\nto identify the specific issue. Check the syntax carefully"
  );

(async () => {
  if (!script) {
    const readline = require("readline");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const rep = () => {
      rl.question("> ", async (stmt) => {
        if (stmt === "quit") {
          if (argv.web) {
            const data = scope.internal.data;
            if (Object.keys(data).length) {
              data.url = await scope.internal.page.url();
              console.log(JSON.stringify(data));
            }
            await scope.parent.internal.browser.close();
          }
          rl.close();
          return;
        }
        const r = parser.grammar.match(stmt, "Rule");
        if (r.succeeded()) {
          const n = parser.semantics(r);
          if (n.errors.length > 0) {
            process.stderr.write(
              stringifyError(new Error(n.errors[0].message), {
                color: process.stderr.isTTY,
              })
            );
          } else {
            try {
              const out = stringify(await evalRule(n.asAST, scope));
              process.stdout.write("\u001b[32m" + out + "\u001b[0m");
            } catch (e) {
              process.stderr.write(
                stringifyError(e, {
                  document: "repl",
                  color: process.stderr.isTTY,
                })
              );
            }
          }
        } else {
          let e;
          try {
            e = new Error(r.shortMessage);
          } catch (_) {
            e = genUnknownParseError();
          }
          process.stderr.write(
            stringifyError(e, {
              color: process.stderr.isTTY,
            })
          );
        }
        process.stdout.write("\n");
        rep();
      });
    };
    rep();
  } else {
    let document, code;
    try {
      document = path.resolve(process.cwd(), script);
      code = fs.readFileSync(document, "utf8");
    } catch (err) {
      process.stderr.write(
        stringifyError(new Error(err.message), {
          color: process.stderr.isTTY,
        })
      );
      process.stderr.write("\n");
      process.exit(1);
    }

    const r = parser.grammar.match(code);
    if (r.succeeded()) {
      const n = parser.semantics(r);
      if (n.errors.length > 0) {
        n.errors.forEach((err) => {
          process.stderr.write(
            stringifyError(new Error(err.message), {
              color: process.stderr.isTTY,
            })
          );
          process.stderr.write("\n");
        });
      } else {
        try {
          await evalRuleSet({
            type: "RuleSet",
            rules: n.asAST,
            scope,
          });
        } catch (e) {
          process.stderr.write(
            stringifyError(e, {
              /*
                TODO: Support multi-file stack traces (across imports)
                BODY: document should be extracted from the AST so we can support multi-file stack traces
              */
              document,
              snippet: true,
              color: process.stderr.isTTY,
            })
          );
          process.stderr.write("\n");
        }
      }
    } else {
      let e;
      try {
        e = new Error(r.shortMessage);
      } catch (_) {
        e = genUnknownParseError();
      }
      process.stderr.write(
        stringifyError(e, {
          color: process.stderr.isTTY,
        })
      );
      process.stderr.write("\n");
    }
  }

  await closeAllScopes();
})();
