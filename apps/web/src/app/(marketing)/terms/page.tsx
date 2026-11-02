import type { Metadata } from "next";
import { LegalPage, legalContact } from "@/components/marketing/legal-page";
import { BRAND, LEGAL } from "@/lib/marketing";

export const metadata: Metadata = {
  title: `Terms of service — ${BRAND.name}`,
  description: `The rules for using ${BRAND.name}.`,
};

const body = `These terms govern your use of ${BRAND.name}, provided by ${LEGAL.company} ("we"). By creating a workspace you agree to them on behalf of yourself and the organisation you represent.

## The beta
${BRAND.name} is in public beta. It is provided free of charge, "as is", with the fair-use limits shown on the pricing page. Features may change, and we may pause or end the beta with reasonable notice. We will give plenty of notice before any paid plans apply to you.

## Your account
Keep your credentials secure and tell us about any unauthorised use. Workspace admins are responsible for who they invite and the roles they assign.

## Acceptable use
You are responsible for the people you contact and the emails you send. You agree to:
- Comply with anti-spam and privacy laws that apply to you and your recipients, such as CAN-SPAM, GDPR and PECR.
- Only email people you have a lawful basis to contact, and never use lists you aren't permitted to use.
- Use accurate sender names, addresses and subject lines, and include your real business postal address (the product adds it to every campaign email).
- Honour unsubscribes — the product does this automatically; don't work around it.
- Not send malware, phishing, illegal content, harassment, or content that infringes others' rights.
- Not attempt to bypass limits, access other workspaces, or disrupt the service.

We may suspend sending or accounts that put recipients, deliverability or the service at risk.

## Your content and data
You keep all rights to the data and content you put into the product. You give us permission to process it only to provide and secure the service. Our handling of personal data is described in the privacy policy.

## AI output
AI-generated drafts and classifications can be wrong. Review content before sending; you are responsible for what you send.

## Termination
You can delete your workspace or account at any time from Settings. We may terminate access for serious or repeated breaches of these terms.

## Liability
To the extent the law allows, we are not liable for indirect or consequential losses, lost profits, or lost data, and during the free beta our total liability is limited to the amount you paid us in the past twelve months.

## Changes and contact
We may update these terms; material changes will be announced to workspace admins before they take effect. Questions: ${legalContact()}.`;

export default function TermsPage() {
  return <LegalPage title="Terms of service" body={body} />;
}
