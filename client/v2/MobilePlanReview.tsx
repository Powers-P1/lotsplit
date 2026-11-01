import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BuyerId, CollectionItem, PlanAssignmentView } from '../../shared/types';
import { Basket, Status, money } from './ui';

type Props = {
  items: CollectionItem[];
  assignments: PlanAssignmentView[];
  revised: boolean;
  expanded?: BuyerId;
  onToggle: (buyerId: BuyerId) => void;
};

export default function MobilePlanReview({ items, assignments, revised, expanded, onToggle }: Props) {
  const prefix = useId();
  return <section className="v-mobile-plan-review" aria-label="Buyer baskets">
    {assignments.map(assignment => {
      const open = expanded === assignment.buyerId;
      const headingId = `${prefix}-${assignment.buyerId}-heading`;
      const basketId = `${prefix}-${assignment.buyerId}-basket`;
      const holdKept = assignment.payment.authorization?.status === 'AUTHORIZED' && !assignment.payment.void;
      return <section className="v-mobile-plan-buyer" key={assignment.buyerId} aria-labelledby={headingId}>
        <div className="v-mobile-plan-summary">
          <div><h2 id={headingId}>{assignment.buyerName}</h2><p>{assignment.itemIds.length} {assignment.itemIds.length === 1 ? 'item' : 'items'}</p></div>
          <strong className="v-mobile-plan-amount">{money(assignment.totalCents)}</strong>
        </div>
        <dl className="v-mobile-plan-status">
          <div><dt>{revised ? 'Approval' : 'Status'}</dt><dd><Status tone={assignment.consent || !revised ? 'ok' : 'wait'}>{assignment.consent?.preservedFromPlanId ? 'Kept' : assignment.consent ? 'Approved' : revised ? 'Needed' : 'Ready for review'}</Status></dd></div>
          {revised ? <div><dt>PayPal hold</dt><dd><Status tone={holdKept ? 'ok' : 'wait'}>{holdKept ? 'Kept' : 'Needed'}</Status></dd></div> : null}
        </dl>
        <button type="button" className="v-mobile-plan-expand" aria-expanded={open} aria-controls={basketId} aria-label={`${open ? 'Hide' : 'Show'} ${assignment.buyerName}'s complete basket`} onClick={() => onToggle(assignment.buyerId)}><span>{open ? 'Hide' : 'Show'} complete basket</span><ChevronDown size={18} strokeWidth={1.7} aria-hidden="true"/></button>
        <div id={basketId} className="v-mobile-plan-basket" role="region" aria-labelledby={headingId} hidden={!open}>{open ? <Basket items={items} ids={assignment.itemIds} withPhoto={false}/> : null}</div>
      </section>;
    })}
  </section>;
}
