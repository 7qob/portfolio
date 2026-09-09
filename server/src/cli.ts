import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { ProjectsService } from './projects/projects.service';
import { UsersService } from './users/users.service';
import type { Role } from './common/types';

/**
 * Bootstrap and recovery, run inside the container:
 *
 *   docker compose exec api node dist/cli.js create-admin <username>
 *   docker compose exec api node dist/cli.js reset-password <username>
 *   docker compose exec api node dist/cli.js list
 *   docker compose exec api node dist/cli.js render
 *
 * create-admin is the answer to the chicken-and-egg problem: accounts are
 * issued from the admin panel, and reaching the admin panel needs an account.
 * It requires a shell on the Pi, which is the correct bar for the one
 * operation that cannot be authenticated.
 *
 * Passwords are generated, printed once and never stored in plaintext — so
 * they are not in your shell history either, which is where they would end up
 * if this took one as an argument.
 *
 * render is the panel's Publish button without the panel: it rewrites every
 * generated page from the database and the renderer that is in this image.
 * It publishes nothing new and changes no row, so it is safe to run twice.
 * The reason it exists is that a renderer change reaches a visitor only when
 * something re-renders, and the deploy that shipped the change already has a
 * shell open on the Pi — an ssh session should not have to become a browser
 * session to finish the update it started.
 */
async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const users = app.get(UsersService);

  try {
    switch (command) {
      case 'create-admin':
      case 'create-user': {
        const username = args[0];
        if (!username) {
          fail(`Usage: node dist/cli.js ${command} <username> [note]`);
        }

        const role: Role = command === 'create-admin' ? 'admin' : 'user';
        const created = await users.create({
          username,
          role,
          note: args[1] ?? null,
        });

        console.log('');
        console.log(`  Account created: ${created.username}  (${created.role})`);
        console.log('');
        console.log(`  Password: ${created.password}`);
        console.log('');
        console.log('  This is shown once. Only its hash is stored — nobody,');
        console.log('  including you, can read it back out later.');
        console.log('');
        break;
      }

      case 'reset-password': {
        const username = args[0];
        if (!username) fail('Usage: node dist/cli.js reset-password <username>');

        const user = users.findByUsername(username);
        if (!user) fail(`No such user: ${username}`);

        const password = await users.resetPassword(user.id);

        console.log('');
        console.log(`  New password for ${user.username}: ${password}`);
        console.log('');
        console.log('  The old password stopped working immediately.');
        console.log('');
        break;
      }

      case 'render': {
        const projects = app.get(ProjectsService);
        projects.renderPublished();

        console.log('');
        console.log('  Rewrote every published page: the project pages, the');
        console.log('  projects index and the home page.');
        console.log('');
        break;
      }

      case 'list': {
        const all = users.listAll();
        if (all.length === 0) {
          console.log('No accounts yet. Create one with: create-admin <username>');
          break;
        }

        console.log('');
        for (const user of all) {
          const state = user.disabled_at ? 'disabled' : 'active';
          const seen = user.last_login_at ?? 'never';
          console.log(
            `  ${user.username.padEnd(20)} ${user.role.padEnd(6)} ${state.padEnd(9)} last login: ${seen}`,
          );
        }
        console.log('');
        break;
      }

      default:
        console.log('Commands: create-admin <username> [note]');
        console.log('          create-user  <username> [note]');
        console.log('          reset-password <username>');
        console.log('          list');
        console.log('          render');
        process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
