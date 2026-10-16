export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.e6code.com") {
      url.hostname = "e6code.com";
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
