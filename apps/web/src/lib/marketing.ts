/**
 * Public-site copy + pricing in one place. Product name (decision D-A) and
 * paid pricing (decided before paid launch) are still open — change them here
 * and every public page follows.
 */
export const BRAND = {
  name: "SuperSaaS",
  tagline: "AI outreach that books meetings, not spam reports.",
  description:
    "Import leads, let AI write grounded multi-step email sequences, send from your own mailboxes, and work every reply from one inbox.",
};

/** Beta is free; these are the enforced V1 limits (Spec → Finance → Rate Limits). */
export const BETA_LIMITS: [string, string][] = [
  ["Emails per month", "1,000"],
  ["Emails per day", "100"],
  ["Leads", "2,000"],
  ["Active campaigns", "5"],
  ["Steps per campaign", "5"],
  ["Connected senders", "3"],
  ["Team members", "3"],
  ["AI sequence generations", "30 / month"],
  ["Reply classification", "Unlimited"],
];

/** Draft paid tiers (Spec → Finance → Pricing Tiers). Flip off to hide them
 *  until pricing is final. */
export const SHOW_PLANNED_TIERS = true;

export interface Tier {
  name: string;
  price: string;
  blurb: string;
  features: string[];
}

export const PLANNED_TIERS: Tier[] = [
  {
    name: "Starter",
    price: "$29",
    blurb: "Solo founders testing outbound",
    features: ["500 emails / mo", "500 leads", "2 active campaigns", "1 sender", "Owner only"],
  },
  {
    name: "Growth",
    price: "$49",
    blurb: "Small teams with a steady pipeline",
    features: ["2,000 emails / mo", "2,000 leads", "5 active campaigns", "3 senders", "3 team members"],
  },
  {
    name: "Pro",
    price: "$99",
    blurb: "Outbound as a core channel",
    features: ["10,000 emails / mo", "10,000 leads", "15 active campaigns", "5 senders", "Analytics export"],
  },
  {
    name: "Agency",
    price: "$199",
    blurb: "Running outreach for clients",
    features: ["50,000 emails / mo", "Unlimited leads", "Unlimited campaigns", "10 senders", "White-label + API"],
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Is it really free during the beta?",
    a: "Yes. No card is required. Beta workspaces run with the limits shown above so sending stays healthy for everyone. We'll give plenty of notice before paid plans start.",
  },
  {
    q: "Which mailboxes can I send from?",
    a: "Any SMTP mailbox today, with Amazon SES and Gmail connections rolling out during the beta. You keep your own sender reputation; we enforce daily limits and send windows to protect it.",
  },
  {
    q: "How does the AI know what to write?",
    a: "You describe your business, audience and offer once in the knowledge base. Every sequence the AI drafts is grounded in that context, and you review and edit each step before anything is sent.",
  },
  {
    q: "What happens when someone replies?",
    a: "Replies land in a shared inbox, classified by intent (interested, question, out of office, not interested). The sequence stops for that lead automatically, and out-of-office replies just push the next step back.",
  },
  {
    q: "Can my team work together?",
    a: "Invite teammates by link as admins, managers or agents. Assign conversations, leave internal notes, and mark leads converted, with access changes applied instantly.",
  },
  {
    q: "How do unsubscribes work?",
    a: "Every email carries a one-click unsubscribe link. Unsubscribed addresses go on a suppression list that is checked before every send.",
  },
];
