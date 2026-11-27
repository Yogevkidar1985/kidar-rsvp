export type GuestStatus = 'pending' | 'attending' | 'maybe' | 'declined';
export type Role = 'viewer' | 'editor' | 'owner';

export type TextStyle = {
  font: string; size: number; weight: number; spacing: number; lineHeight: number;
  align: 'right' | 'center' | 'left'; color: string;
};
export type ParticleKind = 'petals' | 'feathers' | 'confetti' | 'hearts' | 'stars' | 'ribbons' | 'dots' | 'squares' | 'triangles' | 'sparkles' | 'mix';
export type Design = {
  /** id of the palette the colours came from; 'custom' after a manual colour change */
  palette: string;
  colors: { bg: string; surface: string; soft: string; ink: string; muted: string; accent: string; line: string; button: string; buttonText: string };
  /** palettes the owner saved from their own colours */
  saved: { name: string; colors: Design['colors'] }[];
  /** corner style of buttons and fields */
  corners: 'sharp' | 'soft' | 'pill';
  /** the one family used for buttons, labels and forms */
  font: string;
  /** optional Latin line above the invitation, e.g. the hosts' names */
  latin: string; latinFont: string;
  /** vertical rhythm between sections, 1 = default */
  spacing: number;
  styles: { headline: TextStyle; hosts: TextStyle; body: TextStyle; date: TextStyle };
  heroShape: 'arch' | 'rounded' | 'full';
  labels: { rsvp: string; rsvpTitle: string; navigate: string; calendar: string; call: string };
  buttons: { navigate: boolean; calendar: boolean; call: boolean };
  entrance: boolean;
  fall: { enabled: boolean; kind: ParticleKind; speed: number; intensity: number; count: number; duration: number; colors: string[]; size: number; thick: number };
  celebrate: { enabled: boolean; kind: ParticleKind; count: number; duration: number; size: number; thick: number; speed: number };
  /** small animated touches: sparkles beside the names, a divider that draws itself, a countdown to the event */
  extras: { sparkle: boolean; countdown: boolean };
  /** where the pin sits on the map, and the address text it was found for */
  geo: { lat: number; lng: number; place: string } | null;
  /** what a link shows inside WhatsApp; an empty field falls back to the event's own texts */
  share: { title: string; description: string };
  /** the venue's own logo, shown in the "how to get there" card */
  venueLogo: string | null;
  /** every text on the invitation is multiplied by this: one knob for "bigger" */
  textScale: number;
};
export type HeroPos = { x: number; y: number; zoom: number; ratio: string; brightness?: number; contrast?: number; overlay?: number };
export type Media = { id: string; kind: 'gallery' | 'venue'; url: string; caption: string | null; path?: string | null; sort?: number };

export type EventContent = {
  id: string; slug: string; name: string;
  hosts: string | null; headline: string | null; intro_text: string | null; closing_text: string | null;
  event_date: string | null; weekday_label: string | null; hebrew_date: string | null;
  reception_time: string | null; ceremony_time: string | null; end_time: string | null;
  venue_name: string | null; address: string | null; waze_url: string | null; gmaps_url: string | null;
  directions: string | null; parking: string | null; contact_phone: string | null; extra_info: string | null;
  hero_url: string | null; hero_pos: HeroPos; video_url: string | null;
  design: Partial<Design>; rsvp_settings: { open?: boolean; max_party?: number };
};
export type EventRow = EventContent & { published: boolean; created_at: string; updated_at: string };

export type PublicGuest = {
  family_name: string; contact_name: string | null; allocated_seats: number | null; status: GuestStatus;
  adults: number; children: number; babies: number; notes: string | null; preferences: string | null;
};
export type PublicInvitation = EventContent & { media: Media[]; guest?: PublicGuest };

export type Guest = {
  id: string; event_id: string; family_name: string; contact_name: string | null; phone: string | null;
  allocated_seats: number | null; adults: number; children: number; babies: number;
  status: GuestStatus; responded_at: string | null;
  arrived: boolean; arrived_count: number | null; arrived_at: string | null;
  table_id: string | null; notes: string | null; preferences: string | null; admin_notes: string | null;
  is_vip: boolean; group_name: string | null; invite_token: string; source: 'admin' | 'public';
  created_at: string; updated_at: string;
  /** present once supabase/migrations/0002_whatsapp.sql has run */
  invited_at?: string | null; reminders_enabled?: boolean; opted_out?: boolean;
  /** present once supabase/migrations/0003_links_analytics.sql has run */
  link_code?: string | null;
};
export type CampaignStatus = 'scheduled' | 'sending' | 'paused' | 'done' | 'cancelled';
export type Campaign = {
  id: string; event_id: string; kind: 'invite' | 'reminder'; name: string; template_name: string | null; body: string;
  status: CampaignStatus; note: string | null; scheduled_at: string | null; created_at: string; started_at: string | null; finished_at: string | null;
};
export type MessageRow = {
  id: number; campaign_id: string; guest_id: string | null; name: string | null; phone: string; body: string | null;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped'; error: string | null; attempts: number; created_at: string; sent_at: string | null;
};
export type TableRow = { id: string; event_id: string; name: string; capacity: number; pos_x: number; pos_y: number; shape: 'round' | 'rect' };
export type Integration = {
  id: string; event_id: string; type: 'webhook' | 'greenapi'; name: string;
  config: { url?: string; secret?: string; recipients?: { name: string; phone: string }[] };
  enabled: boolean; last_status: string | null; last_error: string | null; last_sent_at: string | null;
};
export type ResponseRow = {
  id: number; guest_id: string; status: GuestStatus; adults: number; children: number; babies: number;
  arrived: boolean; source: string; created_at: string;
};

export const STATUS_LABEL: Record<GuestStatus, string> = {
  pending: 'טרם השיבו', attending: 'מגיעים', maybe: 'עדיין לא בטוחים', declined: 'לא מגיעים',
};
