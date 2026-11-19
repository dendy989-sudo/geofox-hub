import test from "node:test";
import assert from "node:assert/strict";
import {statementVisibleInYear,bankStatementCoverage,statementYearGroups} from "../lib/taxes/statement-periods.ts";
const source={id:"s",kind:"statement",tax_year:2025,archived:false,title:"January",data:{document_type:"bank_statement",account_id:"a",statement_month:1,status:"imported",years_in_statement:[2024,2025],imported_years:[2024,2025]}};
test("one January source shows in both years but only counts as January coverage",()=>{
  assert.equal(statementVisibleInYear(source,2024),true);
  assert.equal(statementVisibleInYear(source,2025),true);
  assert.equal(bankStatementCoverage([source],"a",2025)[0].onFile,true);
  assert.equal(bankStatementCoverage([source],"a",2024)[11].onFile,false);
});
test("year groups count actual transaction dates, not the statement label",()=>{
 assert.deepEqual(statementYearGroups([{date:"2024-12-30"},{date:"2025-01-02"},{date:"2024-12-31"}]),[{year:2024,count:2},{year:2025,count:1}]);
});
test("unverified, unrelated, unassigned and archived months do not fill coverage",()=>{
 const items=[{...source,data:{...source.data,status:"awaiting_upload",statement_month:2}}, {...source,id:"other",data:{...source.data,account_id:"b",statement_month:3}}, {...source,id:"unset",data:{...source.data,statement_month:null}}, {...source,id:"old",archived:true}];
 const months=bankStatementCoverage(items,"a",2025);
 assert.equal(months[1].onFile,false);assert.equal(months[1].needsVerification,true);
 assert.equal(months.filter(month=>month.onFile).length,0);
});
