import { it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requireTestDatabaseUrl } from '../../../../../tests/configure-test-environment.js';
import { db } from '@server/database_service.js';
import { crewParticipants, crewSessions, orgs, userOrgs, users } from '@shared/schema/index.js';
import { crewParticipantsService } from '../crew-participants.service.js';

it('lists my rooms in every org I belong to, and none from an org I have left', async () => {
  requireTestDatabaseUrl();
  const rollback = new Error('test rollback');
  try {
    await db.transaction(async tx => {
      const select = vi.spyOn(db, 'select').mockImplementation(tx.select.bind(tx) as any);
      try {
        const tag = randomUUID().slice(0, 8);
        const [a, b, left] = await tx.insert(orgs).values([
          { name: `Rooms A ${tag}` }, { name: `Rooms B ${tag}` }, { name: `Rooms Left ${tag}` },
        ] as any).returning();
        const userId = `rooms-user-${tag}`;
        await tx.insert(users).values({ id: userId, username: userId, password: 'not-used', email: `${userId}@example.test` } as any);
        await tx.insert(userOrgs).values([{ userId, orgId: a.id }, { userId, orgId: b.id }]);

        const room = async (orgId: number, key: string) => {
          const [s] = await tx.insert(crewSessions).values({ organizationId: orgId, sessionKey: `${key}-${tag}`, title: key }).returning();
          await tx.insert(crewParticipants).values({ sessionId: s.id, organizationId: orgId, userId, role: 'owner' });
          return s;
        };
        await room(a.id, 'in-a');
        await room(b.id, 'in-b');
        // A participant row left behind in an org the user no longer belongs to.
        await room(left.id, 'in-left');
        // Someone else's room in a member org.
        await tx.insert(crewSessions).values({ organizationId: a.id, sessionKey: `not-mine-${tag}` });

        const rooms = await crewParticipantsService.listRoomsForUserAcrossOrgs(userId, null);
        expect(rooms.map(r => r.title).sort()).toEqual(['in-a', 'in-b']);
        expect(rooms.find(r => r.title === 'in-b')).toMatchObject({ organizationId: b.id, organizationName: `Rooms B ${tag}`, role: 'owner' });

        // The current org context counts as a membership (an org admin's role org).
        expect((await crewParticipantsService.listRoomsForUserAcrossOrgs(userId, left.id)).map(r => r.title)).toContain('in-left');
        expect(await crewParticipantsService.listRoomsForUserAcrossOrgs(`nobody-${tag}`, null)).toEqual([]);
      } finally {
        select.mockRestore();
      }
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
});
