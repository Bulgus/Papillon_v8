import { QRCode, QRType } from "../shared/canteen";
import { ArdClient } from "./client";

/**
 * ARD's "Mon identifiant QR Code". Only works when the school enabled QR
 * identification on its terminals; otherwise throws with the portal's reason.
 */
export async function fetchArdQRCode(session: ArdClient, accountId: string): Promise<QRCode> {
  const result = await session.getQRCode();
  if (!result.enabled) {
    throw new Error(result.reason);
  }
  return { type: QRType.QRCode, data: result.code, createdByAccount: accountId };
}
