/* Meta Life AI slide design — extracted verbatim from the Meta Life AI Post
   Studio and re-expressed as a pure function. ONE source of truth shared by:
     - the dashboard live preview + client-side rasterizer (docs/app.js)
     - the server renderer (src/render.py via render.html + Playwright)
   mlSlideMarkup(slide, opts) returns the innerHTML of a 1080×1080 slide div.
   The caller wraps it in <div id="mlSlide" style="width:1080px;height:1080px
   position:relative;overflow:hidden;background:#121331">…</div>. */
(function (root) {
  const ACCENT_WAVE = "linearGradient";

  // ---- shared SVG chrome (identical across slide types) ----------------

  function defsAndWatermark() {
    return `
    <svg width="459" height="327" viewBox="0 0 458.408 326.975" style="position:absolute;left:771px;top:660px;">
      <defs>
        <linearGradient id="wmGM" x1="0" y1="0" x2="0" y2="327" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#1F214F" stop-opacity="0.12"></stop>
          <stop offset="1" stop-color="#1F214F" stop-opacity="0.52"></stop>
        </linearGradient>
      </defs>
      <path d="M 339.144 3.304 C 311.797 1.101 270.867 0 229.755 0 C 188.642 0 147.382 1.101 119.301 3.304 C 78.481 6.497 0 63.431 0 213.714 C 0 251.009 23.163 307.503 72.461 307.503 C 166.617 307.503 166.617 211.621 229.204 211.621 C 291.791 211.621 291.791 307.503 385.947 307.503 C 435.245 307.503 458.408 251.009 458.408 213.714 C 458.445 63.431 379.926 6.571 339.144 3.304 Z M 410.724 214.595 C 410.357 219.44 409.733 224.065 408.852 228.324 C 406.393 240.621 401.914 250.201 395.38 255.414 C 392.077 258.02 388.259 259.562 383.891 259.746 C 383.561 259.746 383.23 259.782 382.9 259.782 C 380.11 259.782 377.43 259.525 374.861 259.011 C 344.76 252.991 328.279 213.824 294.728 187.688 C 277.658 174.363 256.184 164.452 226.267 163.938 C 225.496 163.938 224.689 163.901 223.918 163.901 C 200.829 163.901 183.576 171.977 169.223 183.393 C 148.887 199.618 134.351 222.634 117.282 239.152 C 105.021 251.009 91.439 259.525 73.379 259.746 C 73.159 259.746 72.939 259.746 72.718 259.746 C 72.682 259.746 72.682 259.746 72.682 259.746 C 71.507 259.746 70.406 259.599 69.304 259.378 C 59.1 257.066 52.309 244.402 49.152 226.305 C 48.565 222.891 48.087 219.293 47.757 215.512 C 43.389 166.287 61.229 89.751 104.067 59.981 C 109.389 56.273 115.116 53.263 121.246 51.171 C 138.499 45.224 317.119 44.71 337.382 51.171 C 338.006 51.354 338.63 51.575 339.254 51.795 C 341.273 52.529 343.292 53.373 345.238 54.364 C 354.451 58.916 362.784 66.001 370.199 74.811 C 384.552 91.953 395.38 115.667 402.282 140.408 C 409.476 166.14 412.413 192.937 410.724 214.595 Z" fill="url(#wmGM)" fill-rule="nonzero"></path>
      <path transform="translate(163.754,282.94)" d="M 129.176 7.713 C 133.027 14.85 130.364 23.757 123.227 27.608 C 89.336 45.896 60.26 46.255 39.212 41.363 C 28.839 38.952 20.64 35.324 14.943 32.228 C 12.09 30.678 9.846 29.251 8.248 28.157 C 7.448 27.61 6.808 27.145 6.332 26.787 C 6.094 26.608 5.896 26.456 5.741 26.334 C 5.663 26.273 5.595 26.219 5.538 26.173 C 5.509 26.15 5.483 26.129 5.459 26.11 L 5.426 26.083 L 5.411 26.071 C 5.404 26.065 5.397 26.059 14.684 14.686 L 5.397 26.059 C -0.884 20.93 -1.819 11.681 3.31 5.399 C 8.413 -0.85 17.596 -1.807 23.875 3.235 C 23.891 3.248 23.924 3.273 23.973 3.31 C 24.119 3.42 24.406 3.631 24.831 3.922 C 25.683 4.504 27.073 5.397 28.965 6.425 C 32.757 8.486 38.484 11.045 45.86 12.759 C 60.308 16.117 82.017 16.476 109.281 1.764 C 116.418 -2.087 125.325 0.577 129.176 7.713 Z" fill="url(#wmGM)" fill-rule="evenodd"></path>
    </svg>`;
  }

  function topBarAndLogo() {
    return `
    <svg width="1232" height="126" viewBox="0 0 1232 125.092" style="position:absolute;left:-76px;top:-6px;">
      <path d="M 506.638 86.934 L 17.604 38.926 C 7.615 37.946 0 29.546 0 19.51 C 0 8.735 8.735 0 19.51 0 L 1212.499 0 C 1223.269 0 1232 8.731 1232 19.501 C 1232 29.54 1224.378 37.939 1214.386 38.91 L 720.275 86.942 C 711.545 87.791 702.976 89.851 694.815 93.063 L 648.035 111.474 C 625.797 120.226 601.069 120.226 578.831 111.474 L 532.009 93.046 C 523.876 89.845 515.337 87.788 506.638 86.934 Z" fill="rgba(17,19,52,0.72)" fill-rule="nonzero"></path>
    </svg>
    <div style="position:absolute;left:493px;top:11px;width:91px;height:91px;border-radius:50%;background:rgb(18,19,49);display:flex;align-items:center;justify-content:center;">
      ${logoSvg(54)}
    </div>`;
  }

  function logoSvg(size) {
    const gid = "mlLogoGM_" + size;
    return `<svg width="${size}" height="${size}" viewBox="0 0 44 44">
      <defs><radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="3.6" cy="33.7" r="49">
        <stop offset="0" stop-color="#0667E1"></stop><stop offset="1" stop-color="#4CA8FF"></stop>
      </radialGradient></defs>
      <g transform="translate(0,6)"><path d="M 32.55 0.317 C 29.925 0.106 25.997 0 22.051 0 C 18.105 0 14.145 0.106 11.45 0.317 C 7.532 0.624 0 6.088 0 20.511 C 0 24.091 2.223 29.513 6.955 29.513 C 15.991 29.513 15.991 20.311 21.998 20.311 C 28.005 20.311 28.005 29.513 37.042 29.513 C 41.773 29.513 43.996 24.091 43.996 20.511 C 44 6.088 36.464 0.631 32.55 0.317 Z M 39.42 20.596 C 39.385 21.061 39.325 21.505 39.24 21.914 C 39.004 23.094 38.574 24.013 37.947 24.514 C 37.63 24.764 37.264 24.912 36.845 24.929 C 36.813 24.929 36.781 24.933 36.749 24.933 C 36.482 24.933 36.225 24.908 35.978 24.859 C 33.089 24.281 31.507 20.522 28.287 18.014 C 26.649 16.735 24.588 15.783 21.716 15.734 C 21.642 15.734 21.565 15.731 21.491 15.731 C 19.275 15.731 17.619 16.506 16.241 17.601 C 14.29 19.159 12.895 21.368 11.256 22.953 C 10.08 24.091 8.776 24.908 7.043 24.929 C 7.022 24.929 7 24.929 6.979 24.929 C 6.976 24.929 6.976 24.929 6.976 24.929 C 6.863 24.929 6.757 24.915 6.652 24.894 C 5.672 24.672 5.02 23.457 4.717 21.72 C 4.661 21.392 4.615 21.047 4.584 20.684 C 4.164 15.96 5.877 8.614 9.988 5.757 C 10.499 5.401 11.048 5.112 11.637 4.911 C 13.293 4.34 30.436 4.291 32.381 4.911 C 32.441 4.929 32.501 4.95 32.56 4.971 C 32.754 5.042 32.948 5.123 33.135 5.218 C 34.019 5.655 34.819 6.335 35.53 7.18 C 36.908 8.825 37.947 11.101 38.61 13.476 C 39.3 15.946 39.582 18.517 39.42 20.596 Z" fill="url(#${gid})" fill-rule="evenodd"></path></g>
    </svg>`;
  }

  function footer(handle) {
    const h = (handle || "metalifeai.com");
    return `
    <div style="position:absolute;left:0px;top:1030px;width:1080px;height:50px;background:rgb(11,12,32);display:flex;align-items:center;padding:0px 80px;box-sizing:border-box;gap:7px;">
      <div style="width:27px;height:27px;border-radius:50%;background:rgb(223,238,253);display:flex;align-items:center;justify-content:center;"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1.4" y="1.4" width="13.2" height="13.2" rx="3.6" stroke="#333" stroke-width="1.7"></rect><circle cx="8" cy="8" r="3.1" stroke="#333" stroke-width="1.7" fill="none"></circle><circle cx="11.9" cy="4.1" r="1.05" fill="#333"></circle></svg></div>
      <div style="width:27px;height:27px;border-radius:50%;background:rgb(223,238,253);display:flex;align-items:center;justify-content:center;"><svg width="15" height="14" viewBox="0 0 14.667 13.881" fill="#333"><path d="M 3.183 1.523 C 3.183 2.353 2.551 3.024 1.563 3.024 C 0.613 3.024 -0.019 2.353 0 1.523 C -0.019 0.652 0.613 0 1.582 0 C 2.551 0 3.164 0.652 3.183 1.523 Z M 0.08 13.879 L 0.08 4.211 L 3.085 4.211 L 3.085 13.879 L 0.08 13.879 Z" fill-rule="evenodd"></path><path transform="translate(5.414,3.995)" d="M 0.079 3.301 C 0.079 2.095 0.04 1.067 0 0.217 L 2.61 0.217 L 2.749 1.542 L 2.808 1.542 C 3.204 0.928 4.192 0 5.793 0 C 7.77 0 9.253 1.305 9.253 4.151 L 9.253 9.886 L 6.248 9.886 L 6.248 4.527 C 6.248 3.281 5.813 2.432 4.726 2.432 C 3.895 2.432 3.402 3.005 3.204 3.558 C 3.125 3.756 3.086 4.032 3.086 4.31 L 3.086 9.886 L 0.081 9.886 L 0.081 3.301 Z" fill-rule="evenodd"></path></svg></div>
      <div style="width:27px;height:27px;border-radius:50%;background:rgb(223,238,253);display:flex;align-items:center;justify-content:center;"><svg width="8" height="15" viewBox="0 0 7.25 14.667" fill="#333"><path d="M 6.877 2.639 C 6.461 2.555 5.9 2.493 5.547 2.493 C 4.591 2.493 4.529 2.909 4.529 3.574 L 4.529 4.757 L 6.918 4.757 L 6.71 7.209 L 4.529 7.209 L 4.529 14.667 L 1.538 14.667 L 1.538 7.209 L 0 7.209 L 0 4.757 L 1.538 4.757 L 1.538 3.241 C 1.538 1.164 2.514 0 4.965 0 C 5.817 0 6.44 0.125 7.25 0.291 L 6.877 2.639 Z" fill-rule="evenodd"></path></svg></div>
      <span style="margin-left:auto;font-family:Poppins,sans-serif;font-size:20px;color:rgb(223,238,253);">${esc(h)}</span>
    </div>`;
  }

  function waveLineAndArrow() {
    return `
    <svg width="1232" height="648" viewBox="0 0 1232 647.548" style="position:absolute;left:-76px;top:563px;">
      <defs><linearGradient id="mlWline" x1="0" y1="0" x2="1232" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#007DF7"></stop><stop offset="0.55" stop-color="#0667E1"></stop><stop offset="1" stop-color="#3C39C6"></stop>
      </linearGradient></defs>
      <path d="M 506.638 49.736 L 103.714 10.181 C 48.151 4.727 0 48.383 0 104.212 L 0 553.065 C 0 605.247 42.302 647.548 94.483 647.548 L 1137.517 647.548 C 1189.698 647.548 1232 605.247 1232 553.065 L 1232 104.113 C 1232 48.319 1183.908 4.675 1128.375 10.073 L 720.275 49.744 C 711.545 50.593 702.976 52.653 694.815 55.865 L 648.035 74.276 C 625.797 83.028 601.069 83.028 578.831 74.276 L 532.009 55.848 C 523.876 52.647 515.337 50.59 506.638 49.736 Z" fill="#121331" fill-rule="nonzero"></path>
      <path d="M 0 104.212 C 0 48.383 48.151 4.727 103.714 10.181 L 506.638 49.736 C 515.337 50.59 523.876 52.647 532.009 55.848 L 578.831 74.276 C 601.069 83.028 625.797 83.028 648.035 74.276 L 694.815 55.865 C 702.976 52.653 711.545 50.593 720.275 49.744 L 1128.375 10.073 C 1183.908 4.675 1232 48.319 1232 104.113" fill="none" stroke="url(#mlWline)" stroke-width="4"></path>
    </svg>
    <div style="position:absolute;left:503px;top:557px;width:74px;height:74px;border-radius:50%;background:rgb(18,19,49);display:flex;align-items:center;justify-content:center;">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" style="transform:rotate(-90deg);"><path d="M 12 4.5 L 12 19 M 5.8 13 L 12 19.2 L 18.2 13" stroke="#4CA8FF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    </div>`;
  }

  // image area (top 1080×662): uploaded image with position/zoom, else placeholder
  function imageArea(slide) {
    const img = slide.image || "";
    const pos = slide.image_pos || { x: 50, y: 50, zoom: 100 };
    if (img) {
      const scale = (pos.zoom || 100) / 100;
      return `<div style="position:absolute;left:0;top:0;width:1080px;height:662px;overflow:hidden;background:#0b0c20;">
        <img src="${esc(img)}" style="width:1080px;height:662px;object-fit:cover;object-position:${pos.x}% ${pos.y}%;transform:scale(${scale});transform-origin:${pos.x}% ${pos.y}%;" crossorigin="anonymous"/>
      </div>`;
    }
    return `<div style="position:absolute;left:0;top:0;width:1080px;height:662px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(45deg,#1a2040 0px,#1a2040 18px,#151a36 18px,#151a36 36px);">
      <span style="font-family:Poppins,sans-serif;font-size:22px;font-weight:500;letter-spacing:0.14em;color:#6e76a3;background:rgba(11,12,32,0.6);padding:13px 24px;border-radius:8px;">PASTE LINK OR UPLOAD IMAGE</span>
    </div>`;
  }

  // ---- slide variants ---------------------------------------------------

  function articleBody(slide) {
    return `<div style="position:absolute;left:80px;top:678px;width:920px;display:flex;flex-direction:column;gap:24px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-weight:700;font-size:60px;line-height:1.04;letter-spacing:0.5px;color:#DFEEFD;">${esc(slide.headline || "")}</div>
      <div style="font-family:Poppins,sans-serif;font-size:24px;line-height:1.62;letter-spacing:0.5px;color:#BABABA;white-space:pre-wrap;">${esc(slide.summary || "")}</div>
    </div>`;
  }

  function coverBody(slide) {
    return `<div style="position:absolute;left:80px;top:702px;width:920px;display:flex;flex-direction:column;gap:18px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-weight:700;font-size:60px;line-height:1;letter-spacing:0.5px;color:#DFEEFD;">${esc(slide.kicker || "")}</div>
      <div style="font-family:Anton,sans-serif;font-weight:400;font-size:100px;line-height:1.04;letter-spacing:0.5px;color:#DFEEFD;">${esc(slide.title || "")}</div>
    </div>`;
  }

  // detail slide: same dark chrome, no image; paragraphs fill the canvas
  function detailSlide(slide, handle) {
    const paras = (slide.paragraphs || []).map(p =>
      `<div style="font-family:Poppins,sans-serif;font-size:30px;line-height:1.55;letter-spacing:0.3px;color:#D7DEEC;white-space:pre-wrap;">${esc(p)}</div>`
    ).join("");
    return `
      ${topBarAndLogo()}
      ${defsAndWatermark()}
      <div style="position:absolute;left:80px;top:150px;width:920px;display:flex;flex-direction:column;gap:10px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:46px;letter-spacing:1px;color:#4CA8FF;">${esc(slide.heading || "DETAILS")}</div>
        <div style="width:120px;height:5px;border-radius:3px;background:linear-gradient(90deg,#007DF7,#3C39C6);margin:6px 0 22px;"></div>
      </div>
      <div style="position:absolute;left:80px;top:280px;width:920px;display:flex;flex-direction:column;gap:26px;">${paras}</div>
      ${footer(handle)}`;
  }

  // thank-you end slide: centered logo + message, same chrome
  function thanksSlide(slide, handle) {
    return `
      ${topBarAndLogo()}
      ${defsAndWatermark()}
      <div style="position:absolute;left:0;top:330px;width:1080px;display:flex;flex-direction:column;align-items:center;gap:30px;">
        <div style="width:150px;height:150px;border-radius:50%;background:rgb(18,19,49);display:flex;align-items:center;justify-content:center;">${logoSvg(96)}</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:96px;letter-spacing:2px;color:#DFEEFD;line-height:1;">${esc(slide.title || "THANK YOU")}</div>
        <div style="font-family:Poppins,sans-serif;font-size:28px;color:#9AA0B5;text-align:center;max-width:760px;">${esc(slide.subtitle || "Follow for more on VR, AR and road safety.")}</div>
      </div>
      ${footer(handle)}`;
  }

  // ---- entry point ------------------------------------------------------

  function mlSlideMarkup(slide, opts) {
    opts = opts || {};
    const handle = opts.handle || "metalifeai.com";
    const t = slide.type || "article";
    if (t === "detail") return detailSlide(slide, handle);
    if (t === "thanks") return thanksSlide(slide, handle);
    // cover / article: image area on top, content below
    const body = t === "cover" ? coverBody(slide) : articleBody(slide);
    return `
      <div data-screen-label="Main post" style="position:absolute;left:0;top:0;width:1080px;height:1080px;overflow:hidden;background:rgb(0,58,116);">
        ${imageArea(slide)}
        ${waveLineAndArrow()}
        ${defsAndWatermark()}
        ${body}
        ${topBarAndLogo()}
        ${footer(handle)}
      </div>`;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Build the slide list a post turns into (main + detail slides + thanks).
  function postToSlides(post) {
    const slides = [];
    const main = { type: post.template === "cover" ? "cover" : "article",
                   image: post.image || "", image_pos: post.image_pos };
    if (main.type === "cover") { main.kicker = post.kicker || ""; main.title = post.headline || ""; }
    else { main.headline = post.headline || ""; main.summary = post.summary || ""; }
    slides.push(main);
    (post.detail_slides || []).forEach(d =>
      slides.push({ type: "detail", heading: d.heading || "DETAILS", paragraphs: d.paragraphs || [] }));
    if (post.thank_you)
      slides.push({ type: "thanks", title: post.thanks_title || "THANK YOU",
                    subtitle: post.thanks_subtitle || "Follow for more on VR, AR and road safety." });
    return slides;
  }

  root.MLSlides = { mlSlideMarkup, postToSlides };
})(typeof window !== "undefined" ? window : globalThis);
