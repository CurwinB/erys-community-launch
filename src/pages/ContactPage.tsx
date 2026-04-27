import { useState } from "react";
import { Mail, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Seo from "@/components/Seo";

const CONTACT_EMAIL = "info@erys.live";

const ContactPage = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="min-h-screen">
      <Seo
        title="Contact Erys — Get in touch"
        description="Reach the Erys team for support, refund inquiries, sponsored slots, security disclosures, or partnerships at info@erys.live."
        path="/contact"
      />
      <article className="container mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10 border-b border-border pb-6">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Contact
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Get in touch
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            We read every message. For the fastest response, send us an email with as much detail
            as possible.
          </p>
        </header>

        <div className="border border-border bg-card p-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Email
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">{CONTACT_EMAIL}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Typical response within 2–3 business days.
              </p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button asChild className="flex-1 sm:flex-none">
                <a href={`mailto:${CONTACT_EMAIL}`}>
                  <Mail className="mr-2 h-4 w-4" />
                  Email us
                </a>
              </Button>
              <Button variant="outline" onClick={handleCopy} className="flex-1 sm:flex-none">
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold text-foreground">What to include</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Including the right details up front lets us help you faster.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Topic
              title="Refund or contribution issue"
              items={[
                "The launch URL or token ID",
                "Your wallet address",
                "The transaction signature(s) involved",
                "A short description of what went wrong",
              ]}
            />
            <Topic
              title="Sponsored / influencer slot"
              items={[
                "Your handle and audience size",
                "Preferred launch platform (Bags.fm or Pump.fun)",
                "The wallet address you'll launch from",
                "Any time-slot preferences",
              ]}
            />
            <Topic
              title="Security disclosure"
              items={[
                "A clear description of the issue",
                "Steps to reproduce",
                "Any proof-of-concept (please do not exploit live data)",
                "How we should credit you, if at all",
              ]}
            />
            <Topic
              title="Press, partnerships, or press kit"
              items={[
                "Your organization and role",
                "What you're working on",
                "Deadline, if any",
                "Links to prior coverage or work",
              ]}
            />
          </div>
        </section>

        <section className="mt-10 border border-border bg-card p-6">
          <h2 className="mb-2 text-base font-semibold text-foreground">Verifying account ownership</h2>
          <p className="text-sm text-muted-foreground">
            For requests tied to a specific launch or wallet (refunds, account access, data
            requests), please email us from the address you used to sign up, or sign a short
            message from the wallet that controls the launch and include the signature. This
            protects you against impersonation.
          </p>
        </section>
      </article>
    </main>
  );
};

const Topic = ({ title, items }: { title: string; items: string[] }) => (
  <div className="border border-border border-t-primary bg-card p-5">
    <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
    <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  </div>
);

export default ContactPage;