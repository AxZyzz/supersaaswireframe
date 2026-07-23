import { Injectable } from '@nestjs/common';
import { promises as dns } from 'dns';

export interface DnsRecordCheck {
  found: boolean;
  record: string | null;
  detail: string;
}

export interface DnsCheckResult {
  domain: string;
  spf: DnsRecordCheck;
  dmarc: DnsRecordCheck;
  dkim: DnsRecordCheck;
}

/**
 * Live SPF / DMARC / DKIM checks via real public DNS lookups. SPF and DMARC
 * live at known locations so we can verify them outright; DKIM is
 * selector-specific, so we can only guide until a sender is connected (E3
 * provider wiring supplies the selector).
 */
@Injectable()
export class DnsCheckService {
  private async txt(name: string): Promise<string[]> {
    try {
      const records = await dns.resolveTxt(name);
      // Each TXT record can be split into multiple strings — join them.
      return records.map((chunks) => chunks.join(''));
    } catch {
      return [];
    }
  }

  async check(domain: string): Promise<DnsCheckResult> {
    const clean = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '');

    const rootTxt = await this.txt(clean);
    const spfRecord = rootTxt.find((r) => r.toLowerCase().startsWith('v=spf1'));
    const spf: DnsRecordCheck = spfRecord
      ? {
          found: true,
          record: spfRecord,
          detail: spfRecord.includes('amazonses.com')
            ? 'SPF present and already authorizes Amazon SES.'
            : 'SPF present. Add `include:amazonses.com` before sending via SES.',
        }
      : {
          found: false,
          record: null,
          detail:
            'No SPF record. Add a TXT record: `v=spf1 include:amazonses.com ~all`.',
        };

    const dmarcTxt = await this.txt(`_dmarc.${clean}`);
    const dmarcRecord = dmarcTxt.find((r) =>
      r.toLowerCase().startsWith('v=dmarc1'),
    );
    const dmarc: DnsRecordCheck = dmarcRecord
      ? {
          found: true,
          record: dmarcRecord,
          detail: 'DMARC policy published.',
        }
      : {
          found: false,
          record: null,
          detail:
            'No DMARC record. Add a TXT at `_dmarc` e.g. `v=DMARC1; p=none; rua=mailto:you@domain`.',
        };

    // DKIM cannot be checked without the provider's selector.
    const dkim: DnsRecordCheck = {
      found: false,
      record: null,
      detail:
        'DKIM is selector-specific — verified when you connect a sender (SES/Gmail supplies the DNS records to add).',
    };

    return { domain: clean, spf, dmarc, dkim };
  }
}
