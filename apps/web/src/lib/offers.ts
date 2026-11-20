import { api } from "./api";

export interface Offer {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_at: string;
  archived_at: string | null;
}

export const listOffers = () => api<Offer[]>("/offers");

export const createOffer = (body: { name: string; description?: string }) =>
  api<Offer>("/offers", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateOffer = (
  id: string,
  body: Partial<{ name: string; description: string | null; archived: boolean }>,
) =>
  api<Offer>(`/offers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
