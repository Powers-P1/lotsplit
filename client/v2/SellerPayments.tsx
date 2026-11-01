import type { PaymentOperation } from '../../shared/types';
import type { SellerProps } from './Seller';
import { B, Heading, Note, SandboxTag, Status, money } from './ui';

function ReversalStatus({operation}:{operation?:PaymentOperation}){
  if(!operation)return <Status tone="none">Not needed</Status>;
  if(['COMPLETED','VOIDED'].includes(operation.status))return <Status tone="ok">Confirmed</Status>;
  if(operation.status==='FAILED')return <Status tone="error">Failed</Status>;
  return <Status>{operation.status==='PENDING'?'Pending':'Checking'}</Status>;
}
export default function SellerPayments({state:s,mutate,busy,navigate}:SellerProps){
  const p=s.plan;
  if(!p)return <Note>No purchase has been sent for approval yet.</Note>;
  const unknown=p.status==='reconciling'||p.assignments.some(a=>[a.payment.capture,a.payment.authorization,a.payment.order].some(op=>op&&['STARTED','UNKNOWN','PENDING'].includes(op.status)));
  const failed=p.status==='failed', paid=p.status==='paid', expired=s.reservationExpired&&!paid, invalid=p.status==='invalidated';
  const collecting=failed||unknown||paid||p.status==='capturing'||p.assignments.some(a=>a.payment.capture);
  const collected=p.assignments.reduce((sum,a)=>sum+(a.payment.capture?.status==='COMPLETED'?a.totalCents:0),0);
  const reversals=(kind:'refund'|'void')=>{
    const ops=p.assignments.flatMap(a=>a.payment[kind]?[a.payment[kind]!]:[]);
    const unfinished=ops.filter(o=>!['COMPLETED','VOIDED'].includes(o.status));
    return {value:(unfinished.length?unfinished:ops).reduce((sum,o)=>sum+o.amountCents,0),status:unfinished.some(o=>o.status==='FAILED')?'to check':unfinished.length?'pending':'confirmed'};
  };
  const refunds=reversals('refund'),voids=reversals('void');
  const title=paid?'All payments confirmed':expired?'The reservation ended':failed?'Purchase paused':unknown?'Confirming a payment':invalid?'The previous purchase is paused':s.gates.capture.allowed?'Ready to collect the agreed payments':'Waiting for PayPal holds';
  const attention=failed||unknown||expired||invalid||s.priorPaymentBlockers.length>0;
  return <>
    <Heading title={title} subtitle={`${s.collection.name} · Plan ${p.version}`}/><SandboxTag mode={s.mode}/>
    {unknown?<p>{s.mode==='rehearsal'?'We will check the existing simulated operation before continuing.':'We will check the existing PayPal operation before continuing.'}</p>:failed?<p>One payment failed. Later payments have been stopped.</p>:expired?<p>No new authorisations or captures can start. We are checking hold cancellations.</p>:<p>Approvals {s.progress.agreements}/{p.assignments.length} · Authorisations {s.progress.authorizations}/{p.assignments.length} · Collected {money(collected)}</p>}
    <div className="v-table-wrap"><table className="v-table"><thead><tr>
      <th>Buyer</th><th>Amount</th><th>{collecting?'Collection':'Approval'}</th>
      {failed?<><th>Refund</th><th>Hold cancellation</th></>:!collecting?<th>PayPal hold</th>:null}
    </tr></thead><tbody>{p.assignments.map(a=>{
      const pay=a.payment;return <tr key={a.buyerId}>
        <td><strong>{a.buyerName}</strong></td><td>{money(a.totalCents)}</td>
        <td>{collecting?<Status tone={pay.capture?.status==='COMPLETED'?'ok':pay.capture?.status==='FAILED'?'error':pay.capture?'wait':'none'}>{pay.capture?.status==='COMPLETED'?'Collected':pay.capture?.status==='FAILED'?'Failed':pay.capture?'Checking now':'Not started'}</Status>:<Status tone={a.consent?'ok':'wait'}>{a.consent?'Approved':'Waiting'}</Status>}</td>
        {failed?<><td><ReversalStatus operation={pay.refund}/></td><td><ReversalStatus operation={pay.void}/></td></>:!collecting?<td><Status tone={pay.void?.status==='VOIDED'?'none':pay.void?.status==='FAILED'?'error':pay.void?'wait':pay.authorization?.status==='AUTHORIZED'?'ok':'wait'}>{pay.void?.status==='VOIDED'?'Cancelled':pay.void?.status==='FAILED'?'Cancellation failed':pay.void?'Cancellation pending':pay.authorization?.status==='AUTHORIZED'?'Ready':'Waiting'}</Status></td>:null}
      </tr>;
    })}</tbody></table></div>
    {failed||unknown||invalid?<Note tone={failed?'error':'warn'}>Pickup preparation {failed?'blocked':'paused'}</Note>:null}
    {s.priorPaymentBlockers.length?<section className="v-prior-summary"><h2>Previous payments need checking</h2>{s.priorPaymentBlockers.map(b=><p key={b.buyerId}>{b.buyerName} · Plan {b.planVersion} · {b.operations.map(o=>`${o.kind}: ${o.status.toLowerCase()}`).join(', ')}</p>)}</section>:null}
    <div className="v-payment-footer"><div>{failed?<div className="v-summary-pair"><div><span>Refunds {refunds.status}:</span><strong>{money(refunds.value)}</strong></div><div><span>Hold cancellations {voids.status}:</span><strong>{money(voids.value)}</strong></div></div>:<div className="v-summary-amount"><span>{paid?'Confirmed collected':unknown?'Confirmed collected':'To collect'}</span><strong>{money(paid||unknown?collected:s.collection.totalCents)}</strong></div>}</div>
      <div>{paid?<B onClick={()=>navigate('/pickup')}>Prepare one pickup</B>:attention?<B busy={busy} onClick={async()=>{await mutate('/v2/expiry/check',{});await mutate('/payments/reconcile',{});}}>Check {failed?'settlement':'existing payment'}</B>:<B busy={busy} disabled={!s.gates.capture.allowed} onClick={()=>void mutate('/payments/capture',{planId:p.id})}>Collect payments — {money(s.collection.totalCents)}</B>}
        <p className="v-caption">{failed?'Refunds and hold cancellations are complete only when confirmed.':unknown?'No new charge will be created.':'Each payment is collected separately. Pickup preparation starts after all payments are confirmed.'}</p>
      </div>
    </div>
    {s.progress.agreements<p.assignments.length&&!failed?<B variant="text" onClick={()=>navigate('/approvals')}>View missing approvals</B>:null}
    {p.assignments.flatMap(a=>[a.payment.refund,a.payment.void].filter(o=>o?.status==='FAILED').map(o=><B key={o!.id} variant="secondary" busy={busy} onClick={()=>void mutate('/payments/retry-compensation',{operationId:o!.id})}>Retry confirmed {o!.kind} failure for {a.buyerName}</B>))}
  </>;
}
