'use strict';

// ISS-003: Team and member directory (C-004, FR-014, FR-005).
// Read-only. Given a signed-in member id, it returns that member's team and the
// full list of that team's members. That list is the assignable set.
// Password hashes are never returned.

function publicMember(m) {
  return Object.freeze({ id: m.id, username: m.username, display_name: m.display_name });
}

function createDirectory(store) {
  return Object.freeze({
    // Returns { team, members } or null when the id is not a known member.
    forMember(memberId) {
      if (!Number.isInteger(memberId)) return null;
      const me = store.getMember(memberId);
      if (me === null) return null;
      const team = store.getTeam(me.team_id);
      if (team === null) return null;
      return Object.freeze({
        team: Object.freeze({ id: team.id, name: team.name }),
        members: Object.freeze(store.listMembers(team.id).map(publicMember)),
      });
    },
  });
}

module.exports = { createDirectory };
