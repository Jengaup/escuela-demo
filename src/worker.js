// Punto de entrada del Worker: la API vive en /api/*; lo demás son los archivos de public/.
import { handleApi } from './api.js';
import { middleware } from './middleware.js';

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    return middleware(request, env, () => (pathname.startsWith('/api/') ? handleApi(request, env) : env.ASSETS.fetch(request)));
  },
};
