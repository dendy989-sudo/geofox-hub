"use client";

import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/icons";
import { merchantKey, specificMerchant, BULK_SCOPES, type BulkChoice, type BulkScope } from "@/lib/taxes/bulk";
import { ruleMatches } from "@/lib/taxes/model";
import { TAX_CATEGORIES, type TaxCategory, type TaxRecord } from "@/lib/taxes/types";
import { TaxDialog, money } from "./shared";
import "./bulk-edit.css";

const SCOPE_LABELS:Record<BulkScope,string>={
 personal:"Personal",business:"Business (100%)",mixed:"Mixed personal and business",
 transfer:"Transfer between accounts",loan:"Loan / financing",owner_contribution:"Owner contribution",
 owner_draw:"Owner withdrawal",tax_payment:"Tax payment",tax_refund:"Tax refund",
 relief:"Relief payment",excluded:"Exclude from business reporting",
};

interface Props {
 items:TaxRecord[];
 businesses:TaxRecord[];
 rules:TaxRecord[];
 onClose:()=>void;
 onApply:(choice:BulkChoice & {remember_vendor:boolean})=>Promise<void>;
}
export function TaxBulkEditDialog({items,businesses,rules,onClose,onApply}:Props) {
  const [scope,setScope]=useState<BulkScope| "">("");
  const [businessId,setBusinessId]=useState("");
  const [percent,setPercent]=useState("50");
  const [category,setCategory]=useState<TaxCategory>("uncategorized");
  const [remember,setRemember]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const lock=useRef(false);
  const business=scope==="business"||scope==="mixed";
  const names=[...new Set(items.map(merchantKey))];
  const commonVendor=names.length===1?names[0]:"";
  const hasRule=commonVendor!==""&&rules.some(rule=>ruleMatches(rule,items[0]));
  const canRemember=Boolean(commonVendor&&specificMerchant(commonVendor)&&!hasRule&&["personal","business","mixed"].includes(scope));
  const priorDeductions=items.filter(item=>item.data.deduction_confirmed===true).length;
  const total=items.reduce((sum,item)=>sum+Number(item.data.amount_cents||0),0);
  const canSubmit=scope!==""&&(!business || Boolean(businessId)&&category!=="uncategorized"&&(scope==="business"||Number(percent)>0&&Number(percent)<100))&&!busy;
  async function submit(e:FormEvent){
    e.preventDefault();if(!canSubmit||lock.current)return;
    lock.current=true;setBusy(true);setError("");
    try{
      await onApply({scope:scope as BulkScope,business_id:business?businessId:null,
        business_percent:scope==="business"?100:scope==="mixed"?Number(percent):0,
        category:business?category:"uncategorized",remember_vendor:remember&&canRemember});
    }catch(e){setError(e instanceof Error?e.message:"Could not save this bulk edit. Your previous records remain unchanged.");}
    finally{lock.current=false;setBusy(false);}
  }
  return <TaxDialog title={`Bulk edit · ${items.length} transactions`} busy={busy} onClose={onClose}>
    <form className="tx-editor" onSubmit={submit}>
      <div className="tx-bulk-summary">
        <strong>{items.length} selected · {money(total)} net</strong>
        <p>Applies only to the selected transactions. Original dates, amounts, accounts, and source statements are preserved.</p>
        <small>{commonVendor?`Merchant: ${commonVendor}`:`${names.length} different merchant names selected`}</small>
      </div>
      <label className="tx-field"><span>Classify selected transactions as</span><select className="tx-input" value={scope} required onChange={e=>{setScope(e.target.value as BulkScope);setRemember(false);}} disabled={busy}>
        <option value="">Choose a classification</option>{BULK_SCOPES.map(value=><option value={value} key={value}>{SCOPE_LABELS[value]}</option>)}
      </select></label>
      {business ? <div className="tx-form-grid">
        <label className="tx-field"><span>Belongs to business</span><select className="tx-input" value={businessId} required onChange={e=>setBusinessId(e.target.value)} disabled={busy}>
          <option value="">Select business</option>{businesses.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}
        </select></label>
        <label className="tx-field"><span>Business category</span><select className="tx-input" value={category} required onChange={e=>setCategory(e.target.value as TaxCategory)} disabled={busy}>
          {TAX_CATEGORIES.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
        </select></label>
        {scope==="mixed" ? <label className="tx-field"><span>Business portion (%)</span><input className="tx-input" type="number" step="0.01" min="0.01" max="99.99" required value={percent} onChange={e=>setPercent(e.target.value)} disabled={busy}/></label> : null}
      </div> : null}
      <section className="tx-bulk-rule">
        <div className="tx-bulk-rule-title"><Icon name="bolt" size={19}/><strong>Remember this vendor next time?</strong></div>
        {canRemember ? <>
          <label className="tx-checkline"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} disabled={busy}/><span>Save an exact merchant rule for <strong>{commonVendor}</strong> across every bank account and future statement.</span></label>
          <p>The selected records will be updated now. If you save the rule, you’ll then be asked whether to apply it to other matching saved transactions across years, with a preview first.</p>
        </> : hasRule ? <p>An existing rule already matches this merchant. Open Vendor rules if you want to change it or apply it to old records.</p>
          : <p>Select transactions from a single specific vendor to save a reusable rule. You can still bulk edit unrelated transactions together.</p>}
      </section>
      {priorDeductions ? <p className="tx-notice">This selection includes {priorDeductions} previously approved deduction{priorDeductions===1?"":"s"}. Editing their classification resets those deduction approvals for separate review.</p> : null}
      <p className="tx-muted">Business classification is not a tax deduction. Deductibility remains a separate review step. Uncertain items can be edited individually afterward.</p>
      {error ? <p className="tx-notice error" role="alert">{error}</p> : null}
      <div className="tx-dialog-actions"><button type="button" className="tx-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="tx-button primary" disabled={!canSubmit}><Icon name="check" size={15}/>{busy?"Saving batch…":`Apply to ${items.length} selected`}</button></div>
    </form>
  </TaxDialog>;
}
