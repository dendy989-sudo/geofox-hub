import test from "node:test";
import assert from "node:assert/strict";
import {merchantKey,groupRecurringVendors,bulkTransactionData} from "../lib/taxes/bulk.ts";
const tx=(id,vendor,description=vendor,extras={})=>({id,title:vendor,kind:"transaction",tax_year:2024,archived:false,version:1,data:{vendor,description,scope:"business",business_id:"a",business_percent:100,category:"other_expenses",deduction_confirmed:true,deduction_percent:100,review_status:"confirmed",manual_override:false,amount_cents:-2000,date:"2024-05-01",source_row:1,fingerprint:"a".repeat(64),...extras}});
test("recurring merchant suggestions normalize across descriptions and exclude generic labels",()=>{
 const rows=[tx("1","UPSL  League Fee"),tx("2","UPSL League Fee","December fee"),tx("3","Card purchase"),tx("4","Card purchase")];
 const groups=groupRecurringVendors(rows,[]);
 assert.equal(groups.length,1);assert.equal(groups[0].merchant,"UPSL LEAGUE FEE");assert.equal(groups[0].count,2);
 assert.equal(merchantKey(tx("5","","UPSL League Fee")),"UPSL LEAGUE FEE");
});
test("existing saved rules suppress redundant suggestions",()=>{
 const rule={kind:"rule",archived:false,data:{enabled:true,match:"UPSL League Fee",match_type:"exact"}};
 assert.equal(groupRecurringVendors([tx("1","UPSL League Fee"),tx("2","UPSL League Fee")],[rule]).length,0);
});
test("bulk classification preserves original dates, source provenance and amounts, resets deductions",()=>{
 const original=tx("1","UPSL League Fee");
 const result=bulkTransactionData(original,{scope:"personal",business_id:null,business_percent:0,category:"uncategorized"});
 for(const key of ["date","amount_cents","source_row","fingerprint","description","vendor"])assert.equal(result[key],original.data[key]);
 assert.equal(result.business_id,null);assert.equal(result.category,"uncategorized");assert.equal(result.deduction_confirmed,false);assert.equal(result.deduction_percent,null);assert.equal(result.manual_override,true);assert.equal(result.review_status,"confirmed");
});
test("mixed classification retains fraction and category without approving deductions",()=>{
 const result=bulkTransactionData(tx("2","Travel"),{scope:"mixed",business_id:"club",business_percent:25,category:"travel"});
 assert.equal(result.business_percent,25);assert.equal(result.business_id,"club");assert.equal(result.category,"travel");assert.equal(result.deduction_confirmed,false);
});

test("generic bank processor vendor falls back to the repeated description",()=>{
 const rows=[tx("1","POS PURCHASE","UPSL League Fee"),tx("2","POS PURCHASE","UPSL League Fee")];
 const grouped=groupRecurringVendors(rows,[]);
 assert.equal(grouped.length,1);
 assert.equal(grouped[0].merchant,"UPSL LEAGUE FEE");
 const rule={kind:"rule",archived:false,data:{enabled:true,match:"UPSL League Fee",match_type:"exact"}};
 assert.equal(groupRecurringVendors(rows,[rule]).length,0);
});
