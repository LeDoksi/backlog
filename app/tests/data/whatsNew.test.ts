import { WHATS_NEW, hasUnreadWhatsNew, latestWhatsNew, whatsNewDate, type WhatsNewEntry } from '../../src/data/whatsNew';

const two: WhatsNewEntry[] = [
  { date: '2026-11-05', title: 'Новое', points: ['a'] },
  { date: '2026-10-21', title: 'Старое', points: ['b'] }
];

describe('whatsNew', () => {
  it('marks the newest entry, at the start of its day', () => {
    expect(latestWhatsNew(two)).toBe('2026-11-05T00:00:00Z');
    expect(latestWhatsNew([])).toBeNull();
  });

  it('lights the dot for someone who never opened it or saw only older entries', () => {
    expect(hasUnreadWhatsNew(null, two)).toBe(true);
    expect(hasUnreadWhatsNew('2026-10-21T00:00:00Z', two)).toBe(true);
  });

  it('keeps it dark once the newest was seen, for people who came later, and without a server answer', () => {
    expect(hasUnreadWhatsNew('2026-11-05T00:00:00Z', two)).toBe(false);
    expect(hasUnreadWhatsNew('2026-11-06T10:00:00.123+00:00', two)).toBe(false);
    expect(hasUnreadWhatsNew(undefined, two)).toBe(false);
    expect(hasUnreadWhatsNew(null, [])).toBe(false);
  });

  it('keeps entries newest first, one per day, each with points', () => {
    const dates = WHATS_NEW.map((e) => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    for (const e of WHATS_NEW) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.points.length).toBeGreaterThan(0);
    }
  });

  it('shows the date in Russian', () => {
    expect(whatsNewDate('2026-10-21')).toBe('21 октября');
  });
});
