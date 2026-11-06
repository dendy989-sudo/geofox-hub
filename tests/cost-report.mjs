import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {runInNewContext} from 'node:vm';import ts from 'typescript';
const require=createRequire(import.meta.url),m={exports:{}};
const src=readFileSync(new URL('../components/alfred/report.tsx',import.meta.url),'utf8').replace(/import ["']\.\/report\.css["'];/,'');
runInNewContext(ts.transpileModule(src,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const render=text=>renderToStaticMarkup(React.createElement(m.exports.ReportText,{text}));
test('reports format headings lists emphasis and source references',()=>{const html=render('### Summary\n\n**Working** [E1]\n\n- First\n- Second');assert.match(html,/<h3>Summary/);assert.match(html,/<strong>Working/);assert.match(html,/<ul>/);assert.match(html,/alfred-source-ref/);});
test('model HTML, scripts and links remain escaped text',()=>{const html=render('<script>alert(1)</script>\n\n[run](javascript:alert(1))\n\n<img src=x onerror=alert(1)>');assert.doesNotMatch(html,/<script|<img|href=/);assert.match(html,/&lt;script/);});
test('legacy long reports are split into readable paragraphs',()=>{const html=render(Array.from({length:12},(_,i)=>`Sentence ${i} contains a substantial amount of ordinary report text to verify paragraph formatting.`).join(' '));assert.ok((html.match(/<p>/g)??[]).length>=4);});
