import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { staffReturnPath } from "../lib/auth/return-path.ts";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function renderRail(active) {
  const module = { exports: {} };
  const source = fs.readFileSync(new URL("../components/personal/app-rail.tsx", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => name === "@/components/admin/icons" ? { GeofoxMark: () => null, Icon: () => null } : require(name),
  });
  return renderToStaticMarkup(React.createElement(module.exports.PersonalAppRail, { active }));
}

test("personal app sign-in returns only to explicitly allowed local workspaces", () => {
  for (const path of ["/admin", "/apps", "/finance", "/taxes"]) assert.equal(staffReturnPath(path), path);
  for (const path of [undefined, null, ["/taxes"], "//outside.example", "https://outside.example", "/taxes/../admin", "/taxes?next=https://outside.example", "/taxes#x", "javascript:alert(1)", "/\\outside.example"]) assert.equal(staffReturnPath(path), "/admin");
});

test("personal apps share navigation and keep the Hub switch immediately before Profile", () => {
  for (const active of ["apps", "finance", "taxes"]) {
    const html = renderRail(active);
    assert.match(html, /href="\/finance"/);
    assert.match(html, /href="\/taxes"/);
    assert.match(html, /class="hub-area-bottom"><a class="hub-area-button hub-workspace-switch" href="\/admin"[^>]*>[^]*?<span>Hub<\/span><\/a><a class="hub-area-button" href="\/admin#profile\/account"/);
    if (active !== "apps") assert.match(html, new RegExp(`href="/${active}" aria-current="page"`));
    assert.equal((html.match(/aria-current="page"/g) || []).length, active === "apps" ? 0 : 1);
  }
});
