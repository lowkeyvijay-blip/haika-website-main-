import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STORE_PATH = resolve(process.cwd(), 'api/demo-store.json');

function loadStore() {
  try {
    const raw = readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, leads: [], tasks: [], outboxMessages: [], activityLog: [] };
  }
}

export default function handler(req: any, res: any) {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  const pathPart = url.pathname.replace(/^\/api\/?/, '');
  const segments = pathPart.split('/').filter(Boolean);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  
  const store = loadStore();
  
  if (segments.length === 1 && segments[0] === 'health' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: { status: 'ok', store: STORE_PATH, now: new Date().toISOString() } }));
  }
  
  if (segments.length === 1 && segments[0] === 'summary' && req.method === 'GET') {
    const leads = store.leads || [];
    const tasks = store.tasks || [];
    const byStatus: any = {};
    for (const lead of leads) {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
    }
    const now = Date.now();
    let overdue = 0;
    for (const task of tasks) {
      if ((task.status === 'open' || task.status === 'in_progress') && Date.parse(task.dueAt) <= now) {
        overdue++;
      }
    }
    let withoutContactDetails = 0;
    let unassigned = 0;
    for (const lead of leads) {
      if (!lead.email && !lead.phone) withoutContactDetails++;
      if (!lead.owner) unassigned++;
    }
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: { totalLeads: leads.length, byStatus, overdue, withoutContactDetails, unassigned } }));
  }
  
  if (segments.length === 1 && segments[0] === 'leads' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: store.leads || [] }));
  }
  
  if (segments.length === 2 && segments[0] === 'leads' && req.method === 'GET') {
    const lead = (store.leads || []).find((l: any) => l.id === segments[1]);
    if (!lead) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Lead not found.' } }));
    }
    const leadDetail = {
      lead,
      tasks: (store.tasks || []).filter((t: any) => t.leadId === segments[1]),
      outboxMessages: (store.outboxMessages || []).filter((o: any) => o.leadId === segments[1]),
      activityLog: (store.activityLog || []).filter((a: any) => a.leadId === segments[1])
    };
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: leadDetail }));
  }
  
  if (segments.length === 2 && segments[0] === 'clock' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: { now: new Date().toISOString(), initialNow: '2026-11-02T00:00:00.000Z' } }));
  }
  
  if (segments.length === 2 && segments[0] === 'enquiries' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: { outcome: 'created', leadId: 'demo-lead-' + Date.now() } }));
  }
  
  if ((segments[0] === 'seed' || segments[0] === 'reset') && req.method === 'POST') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: { leads: (store.leads||[]).length, tasks: (store.tasks||[]).length, outboxMessages: (store.outboxMessages||[]).length, activityEntries: (store.activityLog||[]).length, now: new Date().toISOString() } }));
  }
  
  if (segments[0] === 'overdue-check' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ ok: true, data: { escalated: 0, affectedLeads: [], overdueLeads: [] } }));
  }
  
  res.setHeader('content-type', 'application/json');
  return res.end(JSON.stringify({ ok: true, data: null }));
}

