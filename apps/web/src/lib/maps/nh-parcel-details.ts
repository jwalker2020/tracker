/**
 * NH GRANIT parcel detail enrichment: fetch related CAMA record by parceloid.
 * Used to show land use description (sluc_desc) and optional county in parcel popup.
 */

const CAMA_TABLE_URL =
  "https://granit24a.sr.unh.edu/hosting/rest/services/Hosted/CAD_ParcelMosaic/FeatureServer/3";

/** Attributes we request from the CAMA table for display. */
export type CamaAttributes = {
  sluc_desc?: string | null;
  townname?: string | null;
  countyname?: string | null;
  displayid?: string | null;
  nhgis_id?: string | null;
  streetnumber?: string | null;
  streetname?: string | null;
  map?: string | null;
  lot?: string | null;
  block?: string | null;
  unit?: string | null;
  sub?: string | null;
  [key: string]: unknown;
};

type ArcGisQueryResponse = {
  features?: Array<{ attributes?: CamaAttributes }>;
  error?: { message?: string };
};

/**
 * Fetch the related CAMA record for a parcel by ParcelOID.
 * Returns the first matching record's attributes or null if none or on error.
 */
export async function fetchCamaByParcelOid(parceloid: number): Promise<CamaAttributes | null> {
  const params = new URLSearchParams({
    where: `parceloid=${parceloid}`,
    outFields: "sluc_desc,townname,countyname,displayid,nhgis_id,streetnumber,streetname,map,lot,block,unit,sub",
    returnGeometry: "false",
    resultRecordCount: "1",
    f: "json",
  });
  const url = `${CAMA_TABLE_URL}/query?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as ArcGisQueryResponse;
    if (data.error || !data.features?.length) return null;
    const attrs = data.features[0]?.attributes;
    return attrs ?? null;
  } catch {
    return null;
  }
}
