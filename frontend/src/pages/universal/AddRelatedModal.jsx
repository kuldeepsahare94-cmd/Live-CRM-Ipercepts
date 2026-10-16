import { UniversalCreateModal } from '../../components/RecordEditModal';

/* ------------------------------------------------------------------
   Create a record in a related module directly from a parent record's
   detail page, with the link back to the parent filled in automatically.

   Two linking styles exist in this CRM and both are handled:
     - a real foreign key column (contacts.account_id, tickets.account_id…)
     - the polymorphic pair used by activity modules
       (calls/meetings/tasks/notes: related_module + related_record_id)

   The parent link is set programmatically and its field is hidden from
   the form, so a user can't accidentally create an "Opportunity for
   Account A" while sitting on Account B.
   ------------------------------------------------------------------ */

// Which embedded relation maps to which module, and how it links back.
// Keyed by the array name the parent record returns.
const RELATION_TARGETS = {
  contacts:      { module: 'contacts' },
  opportunities: { module: 'opportunities' },
  quotations:    { module: 'quotations' },
  subscriptions: { module: 'subscriptions' },
  tickets:       { module: 'tickets' },
  payments:      { module: 'payments' },
  calls:         { module: 'calls',         polymorphic: true },
  meetings:      { module: 'meetings',      polymorphic: true },
  tasks:         { module: 'tasks',         polymorphic: true },
  notes:         { module: 'notes',         polymorphic: true },
  emails:        { module: 'emails',        polymorphic: true },
};

// (v1.8) Where a record can be created from, and what it is linked to:
//   parent module -> relation -> { field of the new record: 'id' (the parent) | a field of the parent }
// A deal made from a contact is that contact's deal AND its account's; a quotation
// made from a deal belongs to the deal, its account and its contact. A relation not
// listed is left read-only rather than creating an orphan.
const PARENT_LINKS = {
  accounts: {
    contacts: { account_id: 'id' }, opportunities: { account_id: 'id' }, quotations: { account_id: 'id' },
    subscriptions: { account_id: 'id' }, tickets: { account_id: 'id' }, payments: { account_id: 'id' },
  },
  contacts: {
    opportunities: { primary_contact_id: 'id', account_id: 'account_id' },
    quotations: { contact_id: 'id', account_id: 'account_id' },
    tickets: { contact_id: 'id', account_id: 'account_id' },
  },
  opportunities: {
    quotations: { opportunity_id: 'id', account_id: 'account_id', contact_id: 'primary_contact_id' },
  },
};

// Only offer creation where we actually know how to link the record back.
// A relation we can't link is better left read-only than silently
// creating an orphan.
export function canCreateRelation(relationKey, parentModuleApiName) {
  const t = RELATION_TARGETS[relationKey];
  if (!t) return false;
  if (t.polymorphic) return true;
  return Boolean(PARENT_LINKS[parentModuleApiName] && PARENT_LINKS[parentModuleApiName][relationKey]);
}

// The module a relation creates into — so the caller checks 'create'
// permission on the RIGHT module. Creating an Opportunity from an Account
// requires create rights on Opportunities, not on Accounts.
export function relationTargetModule(relationKey) {
  return RELATION_TARGETS[relationKey]?.module || null;
}

/* (v1.8) The form is the SAME popup as "Edit record" and as the "+ Add" of a
   list (UniversalCreateModal): the same sections, the same field grid, the
   required fields first, red marks and messages, "Discard changes?" when
   closed with typing in it, Cancel / Create at the bottom right. Before this
   each of them looked different. */
export default function AddRelatedModal({ relationKey, parentModule, parentId, parentLabel, parentRecord, onClose, onCreated }) {
  const target = RELATION_TARGETS[relationKey];
  const parentApi = typeof parentModule === 'string' ? parentModule : (parentModule && parentModule.api_name);
  // The link to the parent is set for the person and its fields are not shown,
  // so a record can never be created for the wrong parent. A polymorphic link is
  // two fields (`related_module` is TEXT: it needs the api_name string, and
  // callers may hand over either the module object or its api_name).
  let hidden;
  let link;
  if (target.polymorphic) {
    hidden = ['related_module', 'related_record_id'];
    link = { related_module: parentApi, related_record_id: parentId };
  } else {
    hidden = []; link = {};
    Object.entries((PARENT_LINKS[parentApi] || {})[relationKey] || {}).forEach(([field, from]) => {
      const v = from === 'id' ? parentId : (parentRecord ? parentRecord[from] : null);
      if (v !== null && v !== undefined && v !== '') { link[field] = v; hidden.push(field); }
    });
  }
  return (
    <UniversalCreateModal
      moduleApiName={target.module}
      hidden={hidden}
      link={link}
      note={parentLabel ? `Will be linked to ${parentLabel}` : ''}
      onClose={onClose}
      onCreated={() => onCreated()} />
  );
}
