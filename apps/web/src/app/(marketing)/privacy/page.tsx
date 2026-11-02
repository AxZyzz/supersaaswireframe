import type { Metadata } from "next";
import { LegalPage, legalContact } from "@/components/marketing/legal-page";
import { BRAND, LEGAL } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `Privacy policy — ${BRAND.name}`,
  description: `How ${BRAND.name} collects, uses and protects data.`,
};

const body = `${BRAND.name} is operated by ${LEGAL.company} ("we"). This policy explains what we collect, why, and the choices you have.

## Two kinds of data
- **Your account data** — your name, email, password (stored only as a one-way hash) and workspace settings. We are the controller of this data.
- **Data you put in the product** — the leads you import, the emails you send, replies you receive and your notes. You are the controller of this data; we process it only to provide the service on your instructions.

## What we collect
- Account and workspace details you enter (name, email, workspace name, website, branding, business postal address).
- Lead records you import or create (for example names, email addresses, companies, titles, phone numbers and custom fields).
- Email activity for campaigns you send: delivery status, opens (via a tracking pixel), clicks (via redirect links), replies and unsubscribes.
- Content you write: templates, campaign steps, knowledge-base text and internal notes.
- Basic technical data needed to run and secure the service (IP address for rate limiting, error logs).

## How we use it
To provide the service (storing your data, sending the emails you schedule, threading replies, generating AI drafts), to keep it secure and within fair-use limits, and to support you. We do not sell personal data, and we do not use your leads or emails to market to them ourselves.

## AI features
When you use AI features, the relevant context (your knowledge base, your brief, reply text for classification) is sent to our model provider to generate a response. We do not allow your data to be used to train their models.

## Service providers
We use infrastructure providers to host the application and database, deliver email, and run AI models (for example Vercel for the web app and Amazon Web Services for email delivery and AI). If you connect a Gmail account, Google processes that mailbox's data under your Google account. Each provider only gets what it needs to perform its function.

## Cookies and local storage
We do not use advertising or analytics cookies. The app stores your sign-in session in your browser's local storage, which is strictly necessary for you to stay signed in. Campaign emails contain a tracking pixel and wrapped links so you can see opens and clicks.

## Unsubscribes
Every campaign email includes a one-click unsubscribe link. Unsubscribed addresses are kept on a suppression list so they are never emailed again from that workspace.

## Retention and deletion
We keep your data while your account and workspace exist. You can:
- **Export** everything in your workspace as JSON (Settings → Data & privacy).
- **Forget a lead** — delete their record while keeping their address suppressed so they aren't contacted again.
- **Delete your workspace** or **your account** at any time from Settings. Deletion is permanent; backups roll off on their normal schedule.

## Your rights
Depending on where you live, you may have the right to access, correct, export, restrict or delete your personal data, and to object to processing. People whose data is in a customer's workspace should contact that customer first; we will help them respond. You can reach us at ${legalContact()}.

## Security
Workspaces are isolated from each other at the database level, sender credentials are encrypted, passwords are hashed, and access within a workspace follows the roles you assign.

## Changes
We will update this page and the date above when this policy changes, and tell workspace admins about material changes.`;

export default function PrivacyPage() {
  return <LegalPage title="Privacy policy" body={body} />;
}
