/**
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE A યુવક IS — cities, and the zones inside them, as data
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every યુવક carries two of these. `profiles.zone_id` is his **city** and
 * `profiles.sub_zone_id` is his **zone** — the column names are the wrong way round and have
 * been since 0001, which is why every report in the panel aliases them (`p.zone_id as city_id,
 * p.sub_zone_id as zone_id`). The names are not renamed here: they are referenced by nine
 * reporting functions, six RLS policies, the registration form and every Excel export, and a
 * rename would be a very large change that improves nothing a person can see. **This module is
 * the vocabulary that stops the confusion spreading** — everything on this side of the line
 * says `city` and `zone`, and the two column names appear only where the database is touched.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * They were three names in an array, and that was the defect
 * ────────────────────────────────────────────────────────────────────────────
 *
 * This file replaces:
 *
 *     export const ZONES = [{ id: 'surat', name: 'સુરત' }];
 *     export const SUBZONES = [{ id: 'vedroad', … }, { id: 'varachha', … }, { id: 'navsari', … }];
 *
 * and a CHECK constraint in 0001 naming the same three ids. Between them they meant that
 * **adding a zone was a release** — a migration to widen the constraint, a bundle to widen the
 * array, and both deployed together or a યુવક registering in the new zone is refused by the
 * database after the form accepted him. A સંઘ that opens a મંડળ in રાંધેર cannot wait for that.
 *
 * So cities and zones are rows the સંચાલક writes, `profiles` carries foreign keys to them, and
 * this module holds only what is TRUE OF ANY city or zone rather than which ones exist:
 *
 *   * what an id may look like, so it can be typed into a URL, a filter and a foreign key;
 *   * what a name may look like, so a list stays readable;
 *   * what "retired" means, and why nothing is ever deleted;
 *   * how a stored row is read back, and what an unreadable one falls to.
 *
 * Nothing here names સુરત, વરાછા or any other place, and nothing here may. The moment a place
 * name appears in this file the release problem is back.
 */

/**
 * An id: lower-case, digits and hyphens, starting with a letter.
 *
 * The same shape `permissions.key` uses and for the same reasons, which are worth stating
 * because they are not stylistic. It goes into a **foreign key** on two million profile rows,
 * a **query string** on the panel's filters (`?city=surat&zone=varachha`), a **CSV column** a
 * સંચાલક opens in Excel, and a **jsonb key** in more than one settings document. Spaces,
 * capitals and Gujarati would survive some of those and not others, and the ones they do not
 * survive fail late and quietly — a filter that silently matches nothing is indistinguishable
 * from a zone with nobody in it.
 *
 * Gujarati belongs in `name`, which is what every screen actually prints. The id is the
 * plumbing and is never shown to a યુવક.
 */
export const GEO_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

export const isGeoId = (v) => typeof v === 'string' && GEO_ID_RE.test(v);

/** How long a printed name may be. Long enough for `સુરત - વરાછા (પૂર્વ)`, short enough for a row. */
export const GEO_NAME_MAX = 60;

/**
 * The two states a city or a zone can be in.
 *
 * **There is no third, and there is no delete.** §7's "suspend, never delete" is the rule this
 * schema keeps for people, and it applies here for a harder reason: a zone id is written into
 * every profile in it, into `daily_activity_records` through those profiles, into audit rows and
 * into exports a સંચાલક has already printed. Deleting a zone would either orphan those or
 * cascade into deleting યુવકો, and both are worse than a row that says it is closed.
 *
 * RETIRED means: nobody new may be put here, it is not offered on the નોંધણી form, and it is
 * still shown everywhere a યુવક who is already in it appears — because he is still in it.
 */
export const GEO_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  RETIRED: 'RETIRED',
});

export const GEO_STATUSES = Object.freeze([GEO_STATUS.ACTIVE, GEO_STATUS.RETIRED]);

export const isGeoStatus = (v) => typeof v === 'string' && GEO_STATUSES.includes(v);

/* ────────────────────────────────────────────────────────────────────────────
   Reading what is stored
   ──────────────────────────────────────────────────────────────────────────── */

const text = (v) => (typeof v === 'string' ? v.trim() : '');

const whole = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * One city row → the shape every screen renders, or null.
 *
 * Null for a row with no usable id, and that is deliberately the ONLY thing that can reject a
 * row here. A city whose name failed to arrive still has an id, and printing the id is better
 * than dropping the city — a યુવક registered in it either way, and a list that quietly loses a
 * place is a list nobody can reconcile against the database.
 */
export function normaliseCity(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = text(raw.id ?? raw.city_id ?? raw.cityId);
  if (!isGeoId(id)) return null;

  return {
    id,
    /** What screens print. Falls back to the id rather than to an empty cell. */
    name: text(raw.name) || id,
    status: isGeoStatus(raw.status) ? raw.status : GEO_STATUS.ACTIVE,
    sort: whole(raw.sort ?? raw.sort_order ?? raw.sortOrder),
    /** How many યુવકો are in it, when the caller asked for the count. Display only. */
    yuvaks: whole(raw.yuvaks ?? raw.yuvak_count ?? raw.count),
  };
}

/**
 * One zone row → the shape every screen renders, or null.
 *
 * A zone with no city is dropped, unlike a city with no name. The difference is what the value
 * is FOR: a zone is only ever meaningful inside a city — the panel's filter is "this city, then
 * this zone", and an admin's scope is a (city, zone) pair — so a zone that cannot say which
 * city it belongs to cannot be offered anywhere without being wrong somewhere.
 */
export function normaliseZone(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = text(raw.id ?? raw.zone_id ?? raw.zoneId);
  const cityId = text(raw.cityId ?? raw.city_id);
  if (!isGeoId(id) || !isGeoId(cityId)) return null;

  return {
    id,
    cityId,
    name: text(raw.name) || id,
    status: isGeoStatus(raw.status) ? raw.status : GEO_STATUS.ACTIVE,
    sort: whole(raw.sort ?? raw.sort_order ?? raw.sortOrder),
    yuvaks: whole(raw.yuvaks ?? raw.yuvak_count ?? raw.count),
  };
}

/**
 * The whole geography, in one shape, from whatever the server sent.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Sorted here, and the order is not a preference
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `sort` first, then name, then id. The સંચાલક orders his own list — `sort` is the column he
 * drags — and two rows he has not ordered fall back to their names so that a list is at least
 * stable between two loads. `id` last breaks a tie between two places with the same name, which
 * is a real case: `સુરત - વરાછા` may exist in two cities.
 *
 * A zone naming a city that is not in the list is **kept**, not dropped, and grouped under its
 * own id. A city that was retired and then removed from a filtered read would otherwise take
 * its zones off the screen with it, and every યુવક in those zones would vanish from the panel
 * with nothing to say why.
 */
export function normaliseGeography(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const cities = (Array.isArray(d.cities) ? d.cities : [])
    .map(normaliseCity)
    .filter(Boolean)
    .sort(byOrder);

  const zones = (Array.isArray(d.zones) ? d.zones : [])
    .map(normaliseZone)
    .filter(Boolean)
    .sort(byOrder);

  return { cities, zones };
}

const byOrder = (a, b) =>
  a.sort - b.sort || a.name.localeCompare(b.name, 'gu') || a.id.localeCompare(b.id);

/** The zones of one city, in the સંચાલક's order. */
export const zonesOf = (zones, cityId) =>
  (Array.isArray(zones) ? zones : []).filter((z) => z.cityId === cityId);

/** Only what a new યુવક may be registered into. Retired places are read, never offered. */
export const activeOnly = (rows) =>
  (Array.isArray(rows) ? rows : []).filter((r) => r.status === GEO_STATUS.ACTIVE);

/**
 * A place's printed name, from its id, for a screen that has the list.
 *
 * Falls back to the id and then to `-`, in that order, because those are three different facts:
 * a name, a place whose name did not arrive, and no place at all. The old `subZoneName()` in
 * shared/domain/constants.js did the same over a hardcoded array; this does it over the list
 * the caller actually loaded.
 */
export const geoName = (rows, id) =>
  (Array.isArray(rows) ? rows : []).find((r) => r.id === id)?.name || id || '-';

/* ────────────────────────────────────────────────────────────────────────────
   Refusing what the resolver would have to guess at
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Is this a city the સંચાલક may save?
 *
 * The asymmetry with `normaliseCity()` is the one every validator in this project has, and it
 * is stated once here for both: a resolver reading a stored row has nobody to tell, so it falls
 * back and carries on; a save is the one moment a mistake can be explained to the person who
 * can fix it. A name that fell back to its id is a row that reads `varachha` in a Gujarati list
 * for ever, and nobody would know it was meant to say વરાછા.
 *
 * English messages: they are read in the panel.
 */
export function validateCity(city) {
  const c = city && typeof city === 'object' && !Array.isArray(city) ? city : null;
  if (!c) return { ok: false, gu: 'The city is missing.' };

  const id = text(c.id);
  if (!id) return { ok: false, gu: 'Give the city a short id, like "surat".' };
  if (!isGeoId(id)) {
    return {
      ok: false,
      gu: 'A city id is lower-case English letters, digits and hyphens, 2-31 characters, starting with a letter - like "surat" or "navsari-rural".',
    };
  }

  const name = text(c.name);
  if (!name) return { ok: false, gu: 'Give the city a name - this is what a yuvak reads.' };
  if (name.length > GEO_NAME_MAX) {
    return { ok: false, gu: `A city name is at most ${GEO_NAME_MAX} characters.` };
  }

  if (!isGeoStatus(c.status)) {
    return { ok: false, gu: 'A city is either ACTIVE or RETIRED.' };
  }

  return { ok: true, city: { id, name, status: c.status, sort: whole(c.sort) } };
}

/**
 * Is this a zone the સંચાલક may save?
 *
 * `cityId` is required and is checked against the list rather than merely for shape, because
 * the database's foreign key would refuse an unknown one with a constraint name — and a
 * સંચાલક reading `zones_city_id_fkey` has been told nothing he can act on (§1 rule 4).
 *
 * @param {object} zone
 * @param {Array}  cities  the cities that exist, so an unknown one is named rather than thrown
 */
export function validateZone(zone, cities = []) {
  const z = zone && typeof zone === 'object' && !Array.isArray(zone) ? zone : null;
  if (!z) return { ok: false, gu: 'The zone is missing.' };

  const id = text(z.id);
  if (!id) return { ok: false, gu: 'Give the zone a short id, like "varachha".' };
  if (!isGeoId(id)) {
    return {
      ok: false,
      gu: 'A zone id is lower-case English letters, digits and hyphens, 2-31 characters, starting with a letter - like "varachha" or "surat-randher".',
    };
  }

  const cityId = text(z.cityId ?? z.city_id);
  if (!cityId) return { ok: false, gu: 'Choose which city this zone is in.' };
  if (!(Array.isArray(cities) ? cities : []).some((c) => c.id === cityId)) {
    return { ok: false, gu: `There is no city called "${cityId}".` };
  }

  const name = text(z.name);
  if (!name) return { ok: false, gu: 'Give the zone a name - this is what a yuvak reads.' };
  if (name.length > GEO_NAME_MAX) {
    return { ok: false, gu: `A zone name is at most ${GEO_NAME_MAX} characters.` };
  }

  if (!isGeoStatus(z.status)) {
    return { ok: false, gu: 'A zone is either ACTIVE or RETIRED.' };
  }

  return { ok: true, zone: { id, cityId, name, status: z.status, sort: whole(z.sort) } };
}

/**
 * Refuses retiring a city while an ACTIVE zone still sits in it.
 *
 * Not a foreign key's job and not the resolver's: it is a statement about two rows, and the
 * failure it prevents is a quiet one rather than a broken one. A retired city whose zones are
 * still offered would keep taking new યુવકો into a place the સંચાલક believes he has closed,
 * and every screen would go on looking correct.
 *
 * Retiring the zones first is the order that works, and the message says so rather than only
 * saying no.
 */
export function canRetireCity(cityId, zones) {
  const open = zonesOf(zones, cityId).filter((z) => z.status === GEO_STATUS.ACTIVE);
  if (!open.length) return { ok: true };

  return {
    ok: false,
    gu:
      open.length === 1
        ? `Retire the zone "${open[0].name}" first - it is still open in this city.`
        : `Retire this city's ${open.length} open zones first.`,
  };
}
