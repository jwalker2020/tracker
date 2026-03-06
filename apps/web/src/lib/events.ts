import pb from "@/lib/pb";

export type CalendarEvent = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay?: boolean;
  color?: string;
};

export async function getEventsInRange(startISO: string, endISO: string) {
  const filter = `start < "${endISO}" && end > "${startISO}"`;

  const res = await pb.collection("events").getList<CalendarEvent>(1, 200, {
    filter,
    sort: "start",
  });

  return res.items;
}
