export type CustomerTicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type CustomerTicketCategory = "general" | "account" | "billing" | "bug" | "safety" | "feedback";
export interface CustomerTicket {
  id: string; reference: string; appSlug: string; appName: string;
  subject: string; category: CustomerTicketCategory; status: CustomerTicketStatus;
  createdAt: string; updatedAt: string;
}
export interface CustomerMessage { id: string; body: string; author: "customer" | "support"; createdAt: string; }
export interface CustomerTicketList { items: CustomerTicket[]; nextCursor: string | null; }
export interface CustomerTicketDetail extends CustomerTicket { messages: CustomerMessage[]; nextMessagesCursor: string | null; }
export interface CustomerReplyResult { message: CustomerMessage; ticketStatus: CustomerTicketStatus; updatedAt: string; replayed: boolean; }
export interface CustomerIdentity { id: string; email: string; emailVerified: true; }
export interface CustomerContext extends CustomerIdentity { appSlug: "novanook"; appName: string; ipKey: string; accountKey: string; }
export interface CustomerCursor { createdAt: string; id: string; }
