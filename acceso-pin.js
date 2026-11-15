"use strict";

(() => {
  const page = new URL(window.location.href);
  if (page.hash) {
    page.searchParams.set("anterior", "1");
    window.history.replaceState(null, "", page);
  } else if (!page.searchParams.has("anterior")) {
    window.location.replace("https://amigo-secreto-juarez.giving-teal-0774.chatgpt.site/");
  }
})();
