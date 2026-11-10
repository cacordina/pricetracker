// Connexion (e-mail + mot de passe). La collection et les envies en dépendent, pas le reste du site.
import { esc } from '../lib/ui.js';

export async function render(root, { store }) {
  if (!store.isConfigured()) {
    root.innerHTML = '<h1>Connexion</h1><p class="state">La sauvegarde en ligne n’est pas encore configurée.</p>';
    return;
  }
  const session = await store.getSession();
  if (session) {
    root.innerHTML = `<h1>Connexion</h1>
      <p class="state">Connecté en tant que ${esc(session.user.email)}.</p>
      <a class="btn" href="#/collection">Voir ma collection</a>
      <button type="button" class="btn sec" id="out">Se déconnecter</button>`;
    root.querySelector('#out').onclick = () => store.signOut();
    return;
  }

  let mode = 'in';
  function draw(message = '', ok = false) {
    root.innerHTML = `
      <h1>${mode === 'in' ? 'Connexion' : 'Créer mon compte'}</h1>
      <form id="form">
        <label class="field"><span>E-mail</span><input type="email" name="email" required autocomplete="email"></label>
        <label class="field"><span>Mot de passe</span><input type="password" name="password" required minlength="8" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}"></label>
        <button class="btn" type="submit">${mode === 'in' ? 'Se connecter' : 'Créer le compte'}</button>
      </form>
      ${message ? `<p class="${ok ? 'banner' : 'error'}">${esc(message)}</p>` : ''}
      <p style="text-align:center;margin-top:16px"><button type="button" class="link" id="swap">${mode === 'in' ? 'Première visite ? Créer mon compte' : 'J’ai déjà un compte'}</button></p>`;
    root.querySelector('#swap').onclick = () => { mode = mode === 'in' ? 'up' : 'in'; draw(); };
    root.querySelector('#form').onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        if (mode === 'in') {
          await store.signIn(form.get('email'), form.get('password'));
          location.hash = '#/collection';
        } else if (await store.signUp(form.get('email'), form.get('password'))) {
          location.hash = '#/collection';
        } else {
          mode = 'in';
          draw('Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous.', true);
        }
      } catch (err) {
        draw(err.message);
      }
    };
  }
  draw();
}
