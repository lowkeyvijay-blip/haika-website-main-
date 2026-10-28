# Implementation Plan — Haika Demo

## Product Principle

Treat the website, chatbot, automation, and dashboard as one lead journey rather than four separate products. A single lead record should carry the prospect's context from first interaction to follow-up.

## Suggested Information Model

### Lead

- Name, phone, email, preferred contact method
- Project type and property type
- Location, size, budget range, and desired timeline
- Source (`website form`, `chatbot`, or campaign)
- Status (`new`, `qualified`, `contacted`, `consultation booked`, `proposal`, `won`, `lost`)
- Owner, next action, last activity, and notes

### Supporting records

- Conversation answers and handoff request
- Follow-up tasks and automation events
- Portfolio/service pages used before conversion

## Phased Build

### 1. Experience and data foundation

- Confirm the demo brand direction, target city/market, service catalogue, and qualifying questions.
- Define the lead record and status transitions above as a shared contract.
- Create a small, believable seed dataset spanning every lead status.

**Exit condition:** a clickable journey and data model are agreed before UI implementation begins.

### 2. Marketing website and enquiry flow

- Build the public-facing pages around trust, visual work, services, and a consultation CTA.
- Implement a short form that creates a draft lead with all essential qualification fields.
- Show a clear confirmation and expectation for the next response.

**Exit condition:** a visitor can become a `new` or `qualified` demo lead.

### 3. Chatbot qualification experience

- Add a guided conversation that captures the same lead fields as the form.
- Offer paths for browsing, asking for a consultation, and requesting a human handoff.
- Save partial responses so the dashboard can show conversation context.

**Exit condition:** chatbot and form submissions produce comparable lead records.

### 4. Automation simulation

- Model deterministic triggers: lead created, lead qualified, follow-up overdue, and consultation requested.
- Surface the outcomes in the UI: acknowledgement, assignment, notification, and next task.
- Keep adapters/interfaces ready for future email, WhatsApp, calendar, or CRM connections; use no live integrations in this demo.

**Exit condition:** every new lead has an owner, status, and next action visible to the viewer.

### 5. Internal dashboard

- Build a pipeline view, lead list, lead detail, and follow-up queue.
- Include only decision-useful metrics: leads by source/status, pending follow-ups, and a simple conversion view.
- Make it easy to demonstrate changing a status and completing a task.

**Exit condition:** the studio owner can understand pipeline state in under a minute.

### 6. Demo polish and validation

- Run the end-to-end story on desktop and mobile layouts.
- Validate empty, partial, and completed enquiries; all status transitions; and accessibility basics.
- Add a short presenter script and reset mechanism for demo data.

## Decisions Needed Before Build

1. Final demo brand: use **Haika** as the studio-facing brand or as the system provider behind a fictional studio.
2. Preferred build stack and hosting target.
3. Whether the demo should prioritize desktop sales presentation, mobile lead capture, or both equally.
4. The first automation channel to simulate most prominently: WhatsApp, email, or both.

## Recommended First Implementation Slice

Build the lead record and seeded demo data first, then deliver one vertical journey: landing-page enquiry → created lead → automated next action → dashboard lead detail. This validates the integrated value proposition before expanding the site or chatbot.
