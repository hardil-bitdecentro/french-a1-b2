// Address of the sync Worker (worker/, deployed with wrangler). Empty would hide sync in the app.
export const SYNC_URL = 'https://french-a1-b2-sync.hardil.workers.dev';

// Public half of the key the Worker signs reminders with. Browsers only accept pushes signed by it.
export const VAPID_PUBLIC_KEY =
  'BD-iHxg8LNRjUSwa_ItSAtyJEohe-8fcTFthheCe0eUPeoIQhWHeFgFO_ka4dIOOf3qtsJVC8blLjLn8sgy8iOQ';

// The AI tutor: a page on claude.ai that runs on the signed-in Claude account (source in tutor/).
export const TUTOR_URL = 'https://claude.ai/artifact/BiwSDwE4BeSXWGwHkUMdhr';
