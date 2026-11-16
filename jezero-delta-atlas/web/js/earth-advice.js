/* earth-advice.js: rule-based "next course of action" for a crew member who pressed SOS.
   PURE and deterministic: no DOM, no clock, no randomness. Same input, same output.
   window.JdaAdvice.suggest({sos, crew, world, mission, limits, speeds}) ->
     {summary, severity:'critical'|'high'|'moderate'|'info', actions:[{id, priority, title, detail, reason, canSend, message?}],
      facts:[{label, value}], updatedAt}
   Lower priority number = more urgent. Everything is a suggestion; the operator decides.
   Works in a browser and under Node (module.exports). */
(function (root) {
  'use strict';

  var T = {
    R_MARS_M: 3389500,
    O2_CAUTION: 25, O2_CRITICAL: 10,        // percent of a full tank (same thresholds as suit.js)
    BAT_CAUTION: 25, BAT_CRITICAL: 10,      // percent of a full battery
    O2_PER_H: { rest: 4, move: 9 },         // assumed use, percent of a full tank per hour (same figures as the suit model)
    HR_HIGH: 150, HR_ELEVATED: 120, HR_LOW: 45,
    TEMP_HOT: 32, TEMP_COLD: 10, TEMP_HOT_HIGH: 38, TEMP_COLD_HIGH: 0,   // suit interior, degrees C
    ETA_MARGIN: 1.25,                       // require 25 % more oxygen time than the trip needs
    MOVING_MPS: 0.1,
    RAD_CAUTION: 36, RAD_DANGER: 55,        // fallback only; the page passes JEZERO_SCIENCE.radiation.limits
    ROVER_MPS: 2.8, FOOT_MPS: 1.4           // fallback only; the page passes JEZERO_SPEEDS
  };
  var RANK = { info: 0, moderate: 1, high: 2, critical: 3 };

  function num(v) { if (typeof v !== 'number' && typeof v !== 'string') return null; if (typeof v === 'string' && !v.trim()) return null; v = Number(v); return isFinite(v) ? v : null; }
  function pc(v) { return v === null ? null : Math.max(0, Math.min(100, v)); }   // percent values are shown and used within 0..100
  function str(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 80); }
  function rad(d) { return d * Math.PI / 180; }
  function haversineM(lat1, lon1, lat2, lon2) {
    var a = Math.sin(rad(lat2 - lat1) / 2), b = Math.sin(rad(lon2 - lon1) / 2);
    var h = a * a + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * b * b;
    return 2 * T.R_MARS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function fmtDist(m) { return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km'; }
  function fmtDur(s) {
    if (!(s >= 0) || !isFinite(s)) return 'unknown';
    var min = Math.round(s / 60);
    if (min < 1) return 'under 1 min';
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + ('0' + (min % 60)).slice(-2) + ' min';
  }
  function pct(v) { return (Math.round(v * 10) / 10) + '%'; }

  function suggest(input) {
    input = input || {};
    var sos = input.sos || null, crew = input.crew || null, world = input.world || null, mission = input.mission || null;
    var lim = input.limits || {}, spd = input.speeds || {};
    var radCaution = num(lim.caution), radDanger = num(lim.danger);
    if (!(radDanger > 0)) radDanger = T.RAD_DANGER;
    if (!(radCaution > 0 && radCaution < radDanger)) radCaution = Math.min(T.RAD_CAUTION, radDanger * 0.8);
    var roverMps = num(spd.rover && spd.rover.mps) > 0 ? num(spd.rover.mps) : T.ROVER_MPS;
    var footMps = num(spd.foot && spd.foot.mps) > 0 ? num(spd.foot.mps) : T.FOOT_MPS;
    var who = str((crew && crew.name) || (sos && (sos.fromName || sos.from)) || 'the crew member', 40);

    var facts = [], actions = [], sev = 'info';
    function raise(s) { if (RANK[s] > RANK[sev]) sev = s; }
    function fact(label, value) { facts.push({ label: label, value: String(value) }); }
    function act(id, priority, severity, title, detail, reason, message) {
      var a = { id: id, priority: priority, title: title, detail: detail, reason: reason, canSend: !!message };
      if (message) a.message = message.charAt(0).toUpperCase() + message.slice(1);
      actions.push(a); raise(severity);
    }

    // ---- values ----
    var hasCrew = !!crew && typeof crew === 'object';
    var o2 = hasCrew ? pc(num(crew.o2Pct)) : null, bat = hasCrew ? pc(num(crew.batPct)) : null, hr = hasCrew ? num(crew.hr) : null;
    var suitT = hasCrew ? num(crew.suitTempC) : null, ambT = hasCrew ? num(crew.ambientTempC) : null;
    var rad_ = hasCrew ? num(crew.radUsvH) : null, dose = hasCrew ? num(crew.doseMsv) : null;
    var mode = hasCrew ? str(crew.mode, 20) : '', speed = hasCrew ? num(crew.speedMps) : null;
    var lat = hasCrew ? num(crew.lat) : null, lon = hasCrew ? num(crew.lon) : null, posKnown = lat !== null && lon !== null, posFromSos = false;
    if (!posKnown && sos && num(sos.lat) !== null && num(sos.lon) !== null) { lat = num(sos.lat); lon = num(sos.lon); posKnown = true; posFromSos = true; }
    var ev = (world && world.events) || {};
    var solar = !!ev.solar, dust = !!ev.dust;
    var moving = (speed !== null && speed > T.MOVING_MPS) || mode === 'walking' || mode === 'returning';
    var target = hasCrew && crew.target && typeof crew.target === 'object' ? crew.target : null;

    // ---- geometry ----
    var base = (mission && mission.base && num(mission.base.lat) !== null && num(mission.base.lon) !== null) ? mission.base
      : (world && world.base && num(world.base.lat) !== null && num(world.base.lon) !== null) ? world.base : null;
    var dBase = posKnown && base ? haversineM(lat, lon, num(base.lat), num(base.lon)) : null;
    var nearest = null;
    if (posKnown && mission && Array.isArray(mission.stops)) {
      mission.stops.forEach(function (s) {
        if (!s || num(s.lat) === null || num(s.lon) === null) return;
        var d = haversineM(lat, lon, num(s.lat), num(s.lon));
        if (!nearest || d < nearest.d) nearest = { d: d, name: str(s.name || s.id, 60) };
      });
    }
    var etaRover = dBase !== null ? dBase / roverMps : null, etaFoot = dBase !== null ? dBase / footMps : null;
    var baseName = str((base && base.name) || 'base camp', 40).toLowerCase() === 'base camp' ? 'base camp' : str(base && base.name, 40);
    var o2Hours = null;
    if (o2 !== null) { var rate = moving ? T.O2_PER_H.move : T.O2_PER_H.rest; o2Hours = o2 / rate; }

    // ---- facts ----
    if (hasCrew) {
      if (o2 !== null) fact('Oxygen', pct(o2));
      if (o2Hours !== null) fact('Oxygen time left (estimate)', fmtDur(o2Hours * 3600) + ' at ' + (moving ? T.O2_PER_H.move : T.O2_PER_H.rest) + '% per hour, ' + (moving ? 'moving' : 'at rest'));
      if (bat !== null) fact('Battery', pct(bat));
      if (hr !== null) fact('Heart rate', Math.round(hr) + ' bpm');
      if (suitT !== null) fact('Suit temperature', (Math.round(suitT * 10) / 10) + ' C');
      if (ambT !== null) fact('Outside temperature', (Math.round(ambT * 10) / 10) + ' C');
      if (rad_ !== null) fact('Radiation', (Math.round(rad_ * 100) / 100) + ' uSv/h (caution ' + radCaution + ', danger ' + radDanger + ')');
      if (dose !== null) fact('Dose so far', (Math.round(dose * 1000) / 1000) + ' mSv');
      if (mode) fact('Mode', mode + (speed !== null ? ', ' + (Math.round(speed * 100) / 100) + ' m/s' : ''));
      if (target && target.label) fact('Heading to', str(target.label, 60));
    }
    if (posKnown) fact(posFromSos ? 'Last known position (from the SOS)' : 'Position', lat.toFixed(4) + ' N, ' + lon.toFixed(4) + ' E');
    if (dBase !== null) {
      fact('Distance to ' + baseName, fmtDist(dBase));
      fact('Time back to ' + baseName, fmtDur(etaRover) + ' by rover, ' + fmtDur(etaFoot) + ' on foot');
    }
    if (nearest) fact('Nearest mission stop', nearest.name + ', ' + fmtDist(nearest.d));
    if (world) fact('Space weather', (solar ? 'solar particle event' : 'no solar event') + ', ' + (dust ? 'dust storm' : 'no dust storm'));

    // ---- rules (lower priority number = more urgent) ----
    if (hasCrew && rad_ !== null && rad_ >= radDanger) {
      act('radiation-danger', 1, 'critical', 'Shelter now and abort the traverse',
        'Radiation is at or above the danger limit. Get inside the rover or habitat, close up, and do not continue the traverse until the level drops.',
        'Radiation ' + (Math.round(rad_ * 100) / 100) + ' uSv/h is at or above the danger limit of ' + radDanger + ' uSv/h.',
        'radiation at your position is above the danger limit. Stop the traverse and shelter in the rover or habitat now. Reply by voice when you are inside.');
    } else if (hasCrew && rad_ !== null && rad_ >= radCaution) {
      act('radiation-caution', 4, 'moderate', 'Limit time outside and move toward shelter',
        'Radiation is in the caution range. Shorten work outside, stay close to the rover, and be ready to shelter if it keeps rising.',
        'Radiation ' + (Math.round(rad_ * 100) / 100) + ' uSv/h is at or above the caution limit of ' + radCaution + ' uSv/h (danger is ' + radDanger + ').',
        'radiation is rising past the caution level. Wrap up what you are doing and move back toward the rover. Confirm by voice.');
    }

    if (hasCrew && solar) {
      act('solar-event', 2, 'critical', 'Shelter in place until the solar event passes',
        'A solar particle event is active. Stay in the rover or habitat, keep communications open, and wait for Earth to clear you to move.',
        'The world state reports a solar particle event.',
        'a solar particle event is active. Shelter in place in the rover or habitat and stay on the radio. Do not start a traverse until we clear you.');
    } else if (!hasCrew && solar) {
      act('solar-event', 2, 'critical', 'Shelter in place until the solar event passes',
        'A solar particle event is active. Crew should stay in the rover or habitat.', 'The world state reports a solar particle event.',
        'a solar particle event is active. Shelter in place and stay on the radio.');
    }
    if (dust) {
      act('dust-storm', 6, 'moderate', 'Shelter in place or travel only on a known route',
        'A dust storm reduces visibility and solar power. Prefer to wait it out in the rover or habitat; if you must move, keep to the route already driven.',
        'The world state reports a dust storm.',
        'a dust storm is active. Shelter in place if you can. If you must move, keep to the route you already drove and report by voice.');
    }

    if (hasCrew && o2 !== null) {
      var low = o2 < T.O2_CAUTION, short = false, tight = false;
      if (o2Hours !== null && etaFoot !== null) { short = o2Hours * 3600 < etaFoot * T.ETA_MARGIN; tight = o2Hours * 3600 < etaRover * T.ETA_MARGIN; }
      if (low || short) {
        var crit = o2 < T.O2_CRITICAL || tight;
        var assume = 'Remaining time is a rough estimate: oxygen % divided by an assumed ' + (moving ? T.O2_PER_H.move : T.O2_PER_H.rest) + '% per hour when ' + (moving ? 'moving' : 'resting') + '.';
        var title, detail, msg;
        if (etaFoot !== null && short && !tight) {
          title = 'Return to ' + baseName + ' now by the rover';
          detail = 'Oxygen would not last the walk back (' + fmtDur(etaFoot) + ') but should last the rover trip (' + fmtDur(etaRover) + '). Go back now by the fastest safe route and keep exertion low.';
          msg = 'your oxygen will not last a walk back. Return to ' + baseName + ' now by the rover on the safest known route and keep exertion low. Confirm by voice.';
        } else if (etaFoot !== null && tight) {
          title = 'Stop exertion, get to shelter and conserve oxygen';
          detail = 'Oxygen may not last even the rover trip back (' + fmtDur(etaRover) + '). Stop work, rest to cut oxygen use, get into the rover or nearest shelter, and prepare a rescue or resupply.';
          msg = 'your oxygen is short for the trip back. Stop, rest to save oxygen, get into the rover or shelter, and tell us your exact oxygen reading by voice.';
        } else if (etaFoot !== null) {
          title = 'Return to ' + baseName + ' now by the fastest safe route';
          detail = 'Oxygen is low but should last the trip back (' + fmtDur(etaRover) + ' by rover, ' + fmtDur(etaFoot) + ' on foot). Go back now, keep exertion low, and do not start new work.';
          msg = 'your oxygen is low. Return to ' + baseName + ' now by the fastest safe route and keep exertion low. Confirm by voice.';
        } else {
          title = low ? 'Conserve oxygen and head back toward ' + baseName : 'Check the route back against oxygen';
          detail = 'Oxygen is low and the distance back is unknown. Reduce exertion and head back by the fastest known route.';
          msg = 'your oxygen is low. Reduce exertion and head back toward ' + baseName + ' by the fastest known route. Confirm by voice.';
        }
        act('oxygen', 2, crit ? 'critical' : 'high', title, detail,
          'Oxygen ' + pct(o2) + (o2Hours !== null ? ', about ' + fmtDur(o2Hours * 3600) + ' left' : '') +
          (etaFoot !== null ? ' against ' + fmtDur(etaRover) + ' by rover or ' + fmtDur(etaFoot) + ' on foot to ' + baseName : '') + '. ' + assume, msg);
      }
    }

    if (hasCrew && bat !== null && bat < T.BAT_CAUTION) {
      var bc = bat < T.BAT_CRITICAL;
      act('battery', bc ? 3 : 5, bc ? 'high' : 'moderate', bc ? 'Cut suit power use and return to charge' : 'Reduce power use and plan the return',
        'Switch off non-essential systems, keep heating and life support on, and head back to recharge' + (etaRover !== null ? ' (about ' + fmtDur(etaRover) + ' by rover)' : '') + '.',
        'Battery ' + pct(bat) + ' is below the ' + (bc ? T.BAT_CRITICAL : T.BAT_CAUTION) + '% ' + (bc ? 'critical' : 'caution') + ' level.',
        'your battery is low. Switch off non-essential systems, keep heating and life support on, and head back to recharge. Confirm by voice.');
    }

    var healthWhy = [];
    var hHigh = false;
    if (hr !== null) {
      if (hr >= T.HR_HIGH) { healthWhy.push('Heart rate ' + Math.round(hr) + ' bpm is at or above ' + T.HR_HIGH); hHigh = true; }
      else if (hr < T.HR_LOW) { healthWhy.push('Heart rate ' + Math.round(hr) + ' bpm is below ' + T.HR_LOW); hHigh = true; }
      else if (hr >= T.HR_ELEVATED && !moving) healthWhy.push('Heart rate ' + Math.round(hr) + ' bpm is at or above ' + T.HR_ELEVATED + ' while not moving');
    }
    if (suitT !== null) {
      if (suitT > T.TEMP_HOT_HIGH || suitT < T.TEMP_COLD_HIGH) { healthWhy.push('Suit temperature ' + (Math.round(suitT * 10) / 10) + ' C is far outside the comfortable range'); hHigh = true; }
      else if (suitT > T.TEMP_HOT || suitT < T.TEMP_COLD) healthWhy.push('Suit temperature ' + (Math.round(suitT * 10) / 10) + ' C is outside ' + T.TEMP_COLD + ' to ' + T.TEMP_HOT + ' C');
    }
    if (hasCrew && healthWhy.length) {
      act('health', hHigh ? 3 : 5, hHigh ? 'high' : 'moderate', 'Stop, rest and run a health check',
        'Stop moving, sit or lean on the rover, and run the suit health check. Ask the crew member to confirm status by voice and describe how they feel before anything else.',
        healthWhy.join('; ') + '.',
        'your vitals look abnormal. Stop and rest now, run the suit health check, and tell us by voice how you feel.');
    }

    if (hasCrew && mode === 'returning') {
      act('returning', 8, 'info', 'Crew member is already returning',
        'Let them continue to ' + baseName + ' and track progress' + (etaRover !== null ? ' (about ' + fmtDur(etaRover) + ' by rover, ' + fmtDur(etaFoot) + ' on foot)' : '') + '.',
        'Mode is returning' + (target && target.label ? ' to ' + str(target.label, 40) : '') + '.');
    }

    if (!hasCrew) {
      act('locate', 7, 'high', 'Locate the last known position',
        posKnown ? 'Last known position from the SOS is ' + lat.toFixed(4) + ' N, ' + lon.toFixed(4) + ' E' + (dBase !== null ? ', ' + fmtDist(dBase) + ' from ' + baseName : '') + (nearest ? ', nearest stop ' + nearest.name : '') + '. Mark it on the map.'
          : 'The SOS carried no position. Check the last position report and the crew schedule.',
        'No live crew data is available, so the advice is limited to the last known position.');
      act('notify-team', 9, 'high', 'Notify the team and prepare support',
        'Tell the base crew and the other crew members that an SOS is open, who sent it, and the last known position. Prepare a rover or support team.',
        'No live crew data is available to judge the risk.');
    }

    // always
    act('confirm-voice', 10, hasCrew ? sev === 'info' ? 'moderate' : sev : 'high', 'Confirm status by voice and ask the crew member\'s own words first',
      'Call ' + who + ' on the radio, ask what happened and how they feel, and let them describe it in their own words before acting on the readings.',
      'The sensors may be wrong or late, and ' + who + ' knows what is happening.',
      'This is Earth control. We received your SOS. Please confirm your status by voice and tell us in your own words what is happening.');
    act('inform-crew', 20, 'info', 'Keep the other crew informed',
      'Tell the other crew members about the SOS and the plan so nobody walks into the problem, and send updates as the situation changes.',
      'Everyone nearby needs the same picture, and a plan agreed with all of them is safer.',
      '' + who + ' has pressed SOS. Stay where you are safe and keep the radio open. We will send updates.');

    actions.sort(function (a, b) { return a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });

    var top = actions[0];
    var summary = hasCrew
      ? (sev === 'critical' ? 'Urgent: ' : sev === 'high' ? 'Serious: ' : '') + (top ? top.title : 'Confirm status') + '. ' + who + ' pressed SOS.'
      : 'No live data for ' + who + '. Use the generic steps below until crew data arrives.';
    if (hasCrew && sev !== 'info' && !healthWhy.length && o2 === null && rad_ === null) summary += ' Limited data.';
    if (!sos && !hasCrew) { sev = 'info'; }

    return { summary: summary, severity: sev, actions: actions, facts: facts, updatedAt: (world && world.t) ? String(world.t) : null };
  }

  var api = { suggest: suggest, haversineM: haversineM, thresholds: T };
  root.JdaAdvice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
