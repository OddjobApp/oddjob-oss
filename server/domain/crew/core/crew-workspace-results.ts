import { formatCrewMoney } from '@shared/crew-money.js';
import type { WorkspaceResultItem, WorkspaceResultPayload } from '@shared/crew-workspace-results.js';
import { ValidationError } from '@server/utils/errors.js';
import { isAmazonUrl } from '@shared/amazon-links.js';
const text = (v: unknown) => typeof v === 'string' ? v : '';
function header(message: any, name: string) { return text(message?.payload?.headers?.find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value); }
function messageBody(part: any): string {
  if (part?.mimeType === 'text/plain') return text(part.decodedText) || (part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '');
  const plain = (part?.parts ?? []).filter((p: any) => p.mimeType !== 'text/html').map(messageBody).filter(Boolean).join('\n');
  if (plain) return plain;
  if (part?.mimeType === 'text/html') return (text(part.decodedText) || (part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<\/?(?:p|div|br|li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return (part?.parts ?? []).map(messageBody).filter(Boolean).join('\n');
}
function attachmentNames(part: any): string[] { return [...(part?.filename ? [String(part.filename)] : []), ...(part?.parts ?? []).flatMap(attachmentNames)]; }
function documentText(value: any): string {
  if (!value || typeof value !== 'object') return '';
  if (value.textRun?.content) return text(value.textRun.content);
  return Object.entries(value).filter(([key]) => !['documentStyle', 'namedStyles', 'inlineObjects', 'positionedObjects'].includes(key)).map(([, child]) => Array.isArray(child) ? child.map(documentText).join('') : documentText(child)).join('');
}
export function workspaceResultPayload(tool: string, data: any, args: Record<string, any>, message = ''): WorkspaceResultPayload | null {
  let items: WorkspaceResultItem[] = [];
  if(tool.includes('financial_snapshot')) {
    if(data?.comparison)items=[{id:'snapshot-comparison',kind:'accounting',title:'Financial snapshot comparison',snapshotComparison:data.comparison}];
    else items=(data.snapshot?[data.snapshot]:data.snapshots??[]).map((s:any):WorkspaceResultItem=>({id:s.id,kind:'accounting',title:s.name,snapshot:s}));
  } else if (['quickbooks_forecast_cashflow', 'calculate_financial_forecast'].includes(tool)) {
    if(data?.complete!==true) return null;
    const forecasts=Array.isArray(data.forecasts)?data.forecasts:[data];
    if (forecasts.some((f:any) => f.complete !== true)) return null;
    items=forecasts.map((f:any,i:number):WorkspaceResultItem=>({id:`forecast:${i}:${f.currency}`,kind:'accounting',...(tool.startsWith('quickbooks_')?{platform:'quickbooks' as const}:{}),title:`${f.currency} financial forecast`,forecast:{complete:true,method:f.method,currency:f.currency,periodUnit:f.periodUnit,series:f.series,scenarios:f.scenarios??[],coverage:f.coverage,assumptions:[...(data.forecasts?data.assumptions??[]:[]),...(f.assumptions??[])],warnings:[...new Set<string>([...(data.warnings??[]),...(f.warnings??[]),...(f.coverage?.excluded??[])])],asOf:f.asOf??data.asOf,predictionAssessment:f.predictionAssessment}}));
  } else if (tool.startsWith('quickbooks_')) {
    if (tool === 'quickbooks_calculate_total') {
      if (data?.complete !== true || !Array.isArray(data.totals) || !Number.isInteger(data.matchedRecords) || data.matchedRecords < 0) return null;
      if (data.totals.some((t: any) => !/^[A-Z]{3}$/.test(t.currency) || typeof t.value !== 'string' || !/^-?\d+(\.\d+)?$/.test(t.value) || !Number.isInteger(t.count) || t.count < 0)) return null;
      const entity = text(data.entity) || text(args.entity);
      const field = text(data.field) || text(args.field);
      const filter = args.overdue ? 'Overdue balances' : args.outstanding ? 'Outstanding balances' : 'All records';
      items = [{ id: `calculation:${entity}:${field}`, kind: 'accounting', platform: 'quickbooks', title: `${entity} calculation`,
        preview: `${filter} · ${data.matchedRecords} records`,
        calculation: { operation: 'SUM', entity, field, filter, matchedRecords: data.matchedRecords, complete: true,
          totals: data.totals.map((t: any) => ({ currency: t.currency, value: t.value, count: t.count })) } }];
    } else if (tool === 'quickbooks_get_report') {
      const lines: string[] = [];
      const reportCurrency = text(data?.Header?.Currency) || 'currency unverified';
      const columns = data?.Columns?.Column ?? [];
      const visit = (rows: any[]) => { for (const row of rows ?? []) {
        for (const cells of [row.Header?.ColData, row.ColData, row.Summary?.ColData]) {
          if (Array.isArray(cells)) lines.push(cells.map((c: any, i: number) => columns[i]?.ColType === 'Money' ? formatCrewMoney(c.value, reportCurrency) : text(c.value)).join(' | '));
        }
        visit(row.Rows?.Row);
      } };
      visit(data?.Rows?.Row);
      items = [{ id: text(args.report), kind: 'accounting', platform: 'quickbooks', quickBooksReport: text(args.report),
        reportStart: text(args.start_date) || undefined, reportEnd: text(args.end_date) || undefined,
        title: text(data?.Header?.ReportName) || text(args.report),
        currency: text(data?.Header?.Currency) || undefined,
        moneyColumns: columns.flatMap((c: any, i: number) => c.ColType === 'Money' ? [i] : []),
        preview: [text(data?.Header?.StartPeriod), text(data?.Header?.EndPeriod), text(data?.Header?.Currency)].filter(Boolean).join(' | '),
        body: [data?.Columns?.Column?.map((c: any) => text(c.ColTitle)).join(' | '), ...lines].filter(Boolean).join('\n').slice(0, 40000) }];
    } else if (['quickbooks_get_company', 'quickbooks_get_record', 'quickbooks_list_records'].includes(tool)) {
      const entity = text(data?.entity);
      items = (data?.items ?? []).filter((r: any) => r?.Id).map((r: any) => {
        const money = (value: unknown) => value == null ? undefined : formatCrewMoney(value, text(r.CurrencyRef?.value) || 'currency unverified');
        const name = text(r.DisplayName) || text(r.Name) || text(r.CompanyName) || text(r.CustomerRef?.name) || text(r.VendorRef?.name);
        const body = Object.entries({ Company: text(r.CompanyName), Name: name,
          'Document number': text(r.DocNumber), Date: text(r.TxnDate), 'Due date': text(r.DueDate),
          Total: money(r.TotalAmt), Balance: money(r.Balance ?? r.CurrentBalance), Currency: text(r.CurrencyRef?.value), Email: text(r.PrimaryEmailAddr?.Address),
          Phone: text(r.PrimaryPhone?.FreeFormNumber), 'Account type': text(r.AccountType), 'Account subtype': text(r.AccountSubType),
          'Item type': text(r.Type), 'Unit price': money(r.UnitPrice), 'Purchase cost': money(r.PurchaseCost),
          Amount: money(r.Amount), 'Home currency total': money(r.HomeTotalAmt), 'Unapplied amount': money(r.UnappliedAmt), Tax: money(r.TxnTaxDetail?.TotalTax), Active: typeof r.Active === 'boolean' ? (r.Active ? 'Yes' : 'No') : undefined,
          Notes: text(r.PrivateNote ?? r.Notes), Lines: Array.isArray(r.Line) ? r.Line.map((line: any) => [text(line.Description), text(line.SalesItemLineDetail?.ItemRef?.name), text(line.DetailType), line.Amount != null ? `Amount: ${money(line.Amount)}` : ''].filter(Boolean).join(' | ')).filter(Boolean).join('\n') : '' })
          .filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
        return { id: `${entity}:${r.Id}`, kind: 'accounting' as const, platform: 'quickbooks' as const,
          quickBooksEntity: entity, quickBooksRecordId: String(r.Id),
          title: `${entity} ${text(r.DocNumber) || name || String(r.Id)}`,
          sender: name || 'QuickBooks', date: text(r.TxnDate), body,
          preview: [r.TotalAmt != null ? `Total: ${money(r.TotalAmt)}` : '', (r.Balance ?? r.CurrentBalance) != null ? `Balance: ${money(r.Balance ?? r.CurrentBalance)}` : '', text(r.AccountType), text(r.CurrencyRef?.value), text(r.DueDate) && `Due: ${r.DueDate}`].filter(Boolean).join(' | ') };
      });
    } else return null;
  } else if (tool.startsWith('youtube_')) {
    if (!['youtube_search', 'youtube_get_video', 'youtube_list_playlist_videos', 'youtube_get_channel', 'youtube_list_playlists', 'youtube_get_playlist', 'youtube_list_comments', 'youtube_get_comment', 'youtube_get_transcript'].includes(tool)) return null;
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
    const isoDuration = (v: unknown) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(text(v)); return m ? (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) : undefined; };
    const mapResource = (resource: any, youtubeKind: 'video' | 'channel' | 'playlist' | 'comment', comment?: any): WorkspaceResultItem => {
      const snippet = comment?.snippet ?? resource.snippet ?? {};
      const details = resource.contentDetails ?? {};
      const stats = resource.statistics ?? {};
      const id = text(comment?.id ?? resource.id?.videoId ?? resource.contentDetails?.videoId ?? snippet.resourceId?.videoId ?? resource.id);
      const url = youtubeKind === 'comment' ? `https://www.youtube.com/watch?v=${encodeURIComponent(text(snippet.videoId ?? args.video_id))}&lc=${encodeURIComponent(id)}` : youtubeKind === 'channel' ? `https://www.youtube.com/channel/${encodeURIComponent(id)}` : youtubeKind === 'playlist' ? `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}` : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      const description = text(snippet.description);
      return {
        id, kind: 'video', platform: 'youtube', youtubeKind,
        title: text(snippet.title) || (comment ? `Comment by ${text(snippet.authorDisplayName) || 'viewer'}` : 'YouTube item'),
        sender: text(snippet.channelTitle ?? snippet.authorDisplayName),
        date: youtubeKind === 'video' ? text(details.videoPublishedAt ?? snippet.publishedAt) : text(snippet.publishedAt),
        preview: comment ? text(snippet.textDisplay ?? snippet.textOriginal) : description.slice(0, 300),
        body: text(description || snippet.textDisplay || snippet.textOriginal).slice(0, 12000),
        thumbnailUrl: text(snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? snippet.thumbnails?.high?.url),
        url,
        channelId: text(snippet.channelId) || undefined,
        customUrl: text(snippet.customUrl) || undefined,
        duration: isoDuration(details.duration),
        hasCaptions: details.caption === true || details.caption === 'true' || undefined,
        viewCount: num(stats.viewCount), likeCount: num(stats.likeCount), commentCount: num(stats.commentCount),
        subscriberCount: num(stats.subscriberCount), videoCount: num(stats.videoCount), itemCount: num(details.itemCount),
      };
    };
    if (tool === 'youtube_get_transcript') {
      items = [{ id: text(args.video_id), kind: 'video', platform: 'youtube', youtubeKind: 'video', title: `Transcript (${text(data.source) === 'audio_transcription' ? 'audio transcription' : 'captions'}${data.language ? ` · ${text(data.language)}` : ''})`, body: text(data.text), preview: text(data.truncated ? 'Transcript truncated at the requested character limit.' : 'Full transcript returned.'), url: `https://www.youtube.com/watch?v=${encodeURIComponent(text(args.video_id))}` }];
    } else {
      const youtubeKind = (resource: any) => (tool === 'youtube_list_comments' ? resource.snippet?.topLevelComment : tool === 'youtube_get_comment' ? resource : null) ? 'comment' as const : tool === 'youtube_get_channel' ? 'channel' as const : ['youtube_list_playlists', 'youtube_get_playlist'].includes(tool) ? 'playlist' as const : 'video' as const;
      items = (data.items ?? []).map((resource: any) => mapResource(resource, youtubeKind(resource), youtubeKind(resource) === 'comment' ? (tool === 'youtube_list_comments' ? resource.snippet?.topLevelComment : resource) : undefined));
      if (tool === 'youtube_get_channel') items.push(...(data.uploads ?? []).map((resource: any) => mapResource(resource, 'video')));
    }
    items = items.filter((item: WorkspaceResultItem) => item.id);
  } else if (tool.startsWith('amazon_')) {
    if (!['amazon_search_products', 'amazon_get_product', 'amazon_get_variations', 'amazon_compare_products'].includes(tool)) return null;
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
    const rawItems = tool === 'amazon_get_product' ? [data?.item ?? data].filter(Boolean) : data?.items ?? [];
    items = rawItems.filter((p: any) => p?.asin).map((p: any) => {
      const asin = text(p.asin);
      const marketplace = isAmazonUrl(p.url) ? new URL(p.url).hostname : 'www.amazon.com';
      return {
        id: asin, kind: 'product' as const, platform: 'amazon' as const, asin,
        title: text(p.title) || `Amazon product ${asin}`,
        brand: text(p.brand) || undefined,
        thumbnailUrl: text(p.imageUrl) || undefined,
        url: isAmazonUrl(p.url) ? p.url : undefined,
        cartUrl: isAmazonUrl(p.cartUrl) && new URL(p.cartUrl).pathname === '/gp/aws/cart/add.html'
          ? text(p.cartUrl)
          : /^[A-Z0-9]{10}$/i.test(asin)
            ? `https://${marketplace}/gp/aws/cart/add.html?ASIN.1=${encodeURIComponent(asin.toUpperCase())}&Quantity.1=1`
            : undefined,
        price: num(p.price?.amount),
        priceDisplay: text(p.price?.display) || undefined,
        currency: text(p.price?.currency) || undefined,
        listPriceDisplay: text(p.listPriceDisplay) || undefined,
        rating: num(p.rating),
        reviewCount: num(p.reviewCount),
        isPrime: p.isPrime === true ? true : undefined,
        availability: text(p.availability) || undefined,
        merchant: text(p.merchant) || undefined,
        preview: Array.isArray(p.features) ? String(p.features[0] ?? '').slice(0, 300) : undefined,
        body: Array.isArray(p.features) ? p.features.map(String).join('\n').slice(0, 12000) : undefined,
        sender: text(p.merchant) || 'Amazon',
      };
    });
  } else if (tool === 'flighthub_search_flights') {
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
    items = (data?.items ?? []).filter((o: any) => o?.offerRef).map((o: any) => {
      const route = [text(o.originCode), text(o.destinationCode)].filter(Boolean).join(' → ');
      return {
        id: text(o.offerRef), kind: 'flight' as const, platform: 'flighthub' as const,
        title: route || text(o.title) || `Flight offer ${text(o.offerRef)}`,
        sender: text(o.airlineName) || 'FlightHub',
        offerRef: text(o.offerRef),
        offerIndex: num(o.offerIndex),
        offerSignature: text(o.signature) || undefined,
        airlineName: text(o.airlineName) || undefined,
        flightNumbers: Array.isArray(o.flightNumbers) ? o.flightNumbers.map(String).slice(0, 4) : undefined,
        originCode: text(o.originCode) || undefined,
        destinationCode: text(o.destinationCode) || undefined,
        departAt: text(o.departAt) || undefined,
        arriveAt: text(o.arriveAt) || undefined,
        durationDisplay: text(o.durationDisplay) || undefined,
        durationMinutes: num(o.durationMinutes),
        stops: num(o.stops),
        stopsDisplay: text(o.stopsDisplay) || undefined,
        cabinClass: text(o.cabinClass) || undefined,
        price: num(o.priceAmount),
        priceDisplay: text(o.priceDisplay) || undefined,
        currency: text(o.currency) || undefined,
        bookingUrl: text(o.bookingUrl) || undefined,
        resultsUrl: text(data?.resultsUrl) || undefined,
        sessionRef: text(data?.sessionId) || undefined,
        url: text(o.bookingUrl) || text(data?.resultsUrl) || undefined,
        preview: [text(o.departAt) && text(o.arriveAt) ? `${text(o.departAt)} → ${text(o.arriveAt)}` : '', text(o.durationDisplay), text(o.stopsDisplay), text(o.cabinClass)].filter(Boolean).join(' · ') || undefined,
      };
    });
  } else if (tool.startsWith('granola_')) {
    if (!['granola_search_meetings', 'granola_list_meetings', 'granola_get_meeting'].includes(tool)) return null;
    // In a room, matches are private to the asker and shared meetings are already
    // on screen as their share turn: neither renders a card from the tool result.
    if (data?.private === true || data?.shared === true) return null;
    const raw = Array.isArray(data) ? data : data?.meetings ?? data?.results ?? data?.items ?? [];
    items = raw.filter((meeting: any) => meeting?.id || meeting?.meeting_id || meeting?.document_id).map((meeting: any) => {
      const id = text(meeting.id ?? meeting.meeting_id ?? meeting.document_id);
      const attendees = (meeting.attendees ?? meeting.people ?? meeting.participants ?? []).map((person: any) => text(person?.name ?? person?.email ?? person)).filter(Boolean);
      const notes = text(meeting.notes ?? meeting.summary ?? meeting.summarized_notes ?? meeting.content);
      return { id, meetingId: id, kind: 'meeting' as const, platform: 'granola' as const,
        title: text(meeting.title ?? meeting.name) || 'Granola meeting', date: text(meeting.date ?? meeting.start_time ?? meeting.created_at),
        meetingDate: text(meeting.date ?? meeting.start_time ?? meeting.created_at), attendees, sender: attendees.join(', ') || undefined,
        folderName: text(meeting.folder_name ?? meeting.folder?.name) || undefined, preview: text(meeting.summary ?? meeting.subtitle ?? notes).slice(0, 1000),
        body: notes.slice(0, 40000), url: text(meeting.url ?? meeting.note_url ?? meeting.granola_url) || undefined };
    });
  } else if (['m365_list_documents', 'm365_read_document'].includes(tool)) {
    items = (tool === 'm365_list_documents' ? data.files ?? [] : [data]).filter((f: any) => f.id || f.documentId).map((f: any) => ({ id: text(f.id ?? f.documentId), platform: 'microsoft365', driveId: text(f.driveId ?? args.drive_id) || undefined, kind: 'document', title: text(f.name ?? f.title) || 'Microsoft document', body: text(f.text).slice(0, 12000), date: text(f.modifiedTime), preview: text(f.mimeType), url: text(f.webUrl) }));
  } else if (['gmail_search', 'gmail_list_messages', 'gmail_get_message', 'gmail_get_thread', 'gmail_get_draft', 'gmail_list_drafts'].includes(tool)) {
    const messages = tool === 'gmail_get_thread' ? data.messages : tool === 'gmail_get_message' ? [data] : tool === 'gmail_get_draft' ? [data.message] : Array.isArray(data) ? data : data.messages ?? data.drafts?.map((d: any) => d.message);
    items = (messages ?? []).filter((m: any) => m?.id).map((m: any) => ({ id: text(m.id), kind: 'email', title: text(m.subject) || header(m, 'Subject') || 'Email — open for details', sender: text(m.from) || header(m, 'From'), replyTo: header(m, 'Reply-To'), messageId: header(m, 'Message-ID'), recipient: header(m, 'To'), attachments: attachmentNames(m.payload), date: text(m.date) || header(m, 'Date'), preview: text(m.snippet), body: messageBody(m.payload).slice(0, 12000), threadId: text(m.threadId) || undefined }));
  } else if (['gcal_list_events', 'gcal_get_event', 'gcal_event_instances'].includes(tool)) {
    items = (tool === 'gcal_get_event' ? [data] : data.events ?? data.items ?? []).filter((e: any) => e?.id).map((e: any) => ({ id: text(e.id), kind: 'calendar', title: text(e.summary) || 'Untitled event', preview: text(e.description).slice(0, 1000), start: text(e.start?.dateTime ?? e.start?.date), end: text(e.end?.dateTime ?? e.end?.date), timeZone: text(e.start?.timeZone ?? data.timeZone), location: text(e.location), url: text(e.htmlLink), calendarId: text(args.calendar_id) || 'primary' }));
  } else if (['gdrive_list_files', 'gdocs_get_document', 'gdocs_read_text', 'gdrive_read_file'].includes(tool)) {
    if (tool === 'gdrive_list_files') items = (Array.isArray(data) ? data : data.files ?? []).map((f: any) => ({ id: text(f.id), kind: 'document', title: text(f.name) || 'Untitled file', date: text(f.modifiedTime), preview: text(f.mimeType), url: text(f.webViewLink) }));
    else items = [{ id: text(data?.documentId ?? args.document_id ?? args.file_id), kind: 'document', title: text(data?.title) || 'Google document', body: (text(typeof data === 'string' ? data : data?.text) || documentText(data?.tabs ?? data?.body)).slice(0, 12000), url: `https://docs.google.com/document/d/${encodeURIComponent(text(data?.documentId ?? args.document_id ?? args.file_id))}/edit` }];
  } else return null;
  items = items.filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index);
  const kind = items[0]?.kind ?? (tool.startsWith('gmail') ? 'email' : tool.startsWith('gcal') ? 'calendar' : 'document');
  return { type: 'google_workspace_results', title: tool.includes('financial_snapshot') ? 'Financial snapshots' : tool.startsWith('quickbooks_') ? 'QuickBooks' : tool.startsWith('youtube_') ? 'YouTube' : tool.startsWith('amazon_') ? 'Amazon' : tool === 'flighthub_search_flights' ? 'Flights' : kind === 'email' ? 'Email' : kind === 'calendar' ? 'Calendar' : 'Documents', presentation: kind === 'calendar' && /\bagenda\b/i.test(message) ? 'agenda' : 'cards', items, sourceTool: tool, sourceArgs: args, nextPageToken: data?.nextPageToken ?? null, nextSkipToken: data?.next_skip_token ?? null, nextOffset: data?.next_offset ?? null, nextStart: tool === 'quickbooks_list_records' ? data?.nextStart ?? null : null };
}

/** The loader must already be bound to the authenticated organization and room. */
export async function resolveWorkspaceSelection(references: unknown, loadRoomTurn: (id: number) => Promise<{ artifacts: unknown } | undefined>): Promise<WorkspaceResultItem[]> {
  if (!Array.isArray(references) || references.length > 20) throw new ValidationError('Select at most 20 source items', { field: 'selectedContext' });
  const items: WorkspaceResultItem[] = [];
  for (const reference of references) {
    if (!Number.isInteger(reference?.turnId) || reference.turnId < 1 || typeof reference?.tool !== 'string' || typeof reference?.itemId !== 'string') throw new ValidationError('Invalid source selection', { field: 'selectedContext' });
    const source = await loadRoomTurn(reference.turnId);
    const item = (Array.isArray(source?.artifacts) ? source.artifacts : []).filter(a => a.tool === reference.tool && a.payload?.type === 'google_workspace_results').flatMap(a => a.payload.items ?? []).find(i => i.id === reference.itemId);
    if (!item) throw new ValidationError('Selected item is unavailable in this room. Select a current result.', { field: 'selectedContext' });
    items.push(item);
  }
  return items;
}

/**
 * Produces a concise, evidence-rich digest of a WorkspaceResultPayload for LLM context.
 * Replaces multi-thousand-character raw JSON envelopes with high-signal summary lines.
 */
export function digestWorkspaceResultForModel(payload: WorkspaceResultPayload): string {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const lines: string[] = [
    `Rendered surface: "${payload.title}" (${items.length} item${items.length === 1 ? '' : 's'}). Visual cards are displayed to the user; do not echo raw JSON envelopes.`,
  ];
  const MAX_DIGEST_ITEMS = 6;
  for (const item of items.slice(0, MAX_DIGEST_ITEMS)) {
    const parts: string[] = [item.title];
    if (item.date) parts.push(`Date: ${item.date}`);
    if (item.sender) parts.push(`From: ${item.sender}`);
    if (item.preview) parts.push(`Summary: ${item.preview}`);
    if (item.calculation) {
      const totals = item.calculation.totals.map((t: any) => `${t.value} ${t.currency} (${t.count})`).join(', ');
      parts.push(`Calculation totals: ${totals}`);
    }
    if (item.forecast) {
      parts.push(`Forecast: ${item.forecast.currency} using ${item.forecast.method}`);
    }
    lines.push(`- ${parts.filter(Boolean).join(' | ')}`);
  }
  if (items.length > MAX_DIGEST_ITEMS) {
    lines.push(`- ...and ${items.length - MAX_DIGEST_ITEMS} more items rendered on the card.`);
  }
  return lines.join('\n');
}
