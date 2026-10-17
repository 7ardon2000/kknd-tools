/**
 * First-run screen: asks for the player's own KKnD files when Setup.cmd has not put them next to
 * the page and none are remembered yet. Accepts SPRITES.LVL or the free demo's KKND_XT.EXE.
 */

const DEMO_URL = 'https://archive.org/download/KKNDXT/KKND_XT.EXE';

const CSS = `
#kknd-setup { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: radial-gradient(ellipse at center, #2a2116 0%, #0b0907 75%); color: #e8dcc0;
  font: 15px/1.5 "Segoe UI", system-ui, sans-serif; overflow: auto; }
#kknd-setup .box { max-width: 680px; width: 100%; background: rgba(20, 16, 11, 0.92); border: 2px solid #8a6a3a;
  border-radius: 6px; padding: 22px 26px; box-shadow: 0 10px 40px #000; }
#kknd-setup h1 { margin: 0 0 6px; font-size: 22px; color: #f0c060; letter-spacing: 0.5px; }
#kknd-setup p { margin: 8px 0; }
#kknd-setup code { background: #000; color: #f0d890; padding: 1px 5px; border-radius: 3px; font-size: 13px;
  user-select: all; word-break: break-all; }
#kknd-setup ul { margin: 6px 0 10px; padding-left: 20px; }
#kknd-setup li { margin: 4px 0; }
#kknd-setup a { color: #f0c060; }
#kknd-setup .drop { margin: 14px 0 6px; border: 2px dashed #8a6a3a; border-radius: 6px; padding: 18px; text-align: center;
  cursor: pointer; background: rgba(138, 106, 58, 0.08); }
#kknd-setup .drop.over { background: rgba(240, 192, 96, 0.18); border-color: #f0c060; }
#kknd-setup button { font: inherit; font-weight: 600; color: #1a1208; background: #f0c060; border: 0; border-radius: 4px;
  padding: 8px 18px; cursor: pointer; }
#kknd-setup .status { min-height: 1.5em; margin-top: 8px; font-weight: 600; }
#kknd-setup .status.error { color: #ff7a5a; }
#kknd-setup .small { font-size: 13px; color: #b0a488; }
`;

const HTML = `
<div class="box" role="dialog" aria-labelledby="kknd-setup-title">
  <h1 id="kknd-setup-title">KKnD Battle needs your KKnD game files</h1>
  <p>This fan wallpaper does not include any original KKnD graphics. It draws the units from your own
  copy of the game. You only have to do this once.</p>
  <p><b>Easiest:</b> run <code>Setup.cmd</code> from the download. It finds your game by itself (GOG, Steam or CD).
  Or choose the file here:</p>
  <ul>
    <li><b>GOG:</b> <code>...\\GOG Galaxy\\Games\\KKnD Xtreme\\LEVELS\\640\\SPRITES.LVL</code> (or <code>C:\\GOG Games\\KKnD Xtreme\\...</code>)</li>
    <li><b>Steam:</b> <code>...\\steamapps\\common\\KKnD Xtreme\\LEVELS\\640\\SPRITES.LVL</code></li>
    <li><b>CD:</b> <code>D:\\LEVELS\\640\\SPRITES.LVL</code> (KKnD Xtreme) or <code>D:\\KKND\\LEVELS\\640\\SPRITES.LVL</code> (KKnD)</li>
    <li><b>No game?</b> Download the free official <a href="${DEMO_URL}" target="_blank" rel="noopener">KKnD Xtreme demo</a>
      (<code>KKND_XT.EXE</code>, 7.7 MB) and choose that file. You don't need to install it.</li>
  </ul>
  <div class="drop" tabindex="0">
    <button type="button">Choose SPRITES.LVL or KKND_XT.EXE</button>
    <div class="small" style="margin-top:6px">or drop the file here</div>
  </div>
  <input type="file" accept=".lvl,.exe,.cab,.zip" hidden />
  <div class="status" aria-live="polite"></div>
  <p class="small">The file stays on this computer. It is remembered by this browser, so it is not asked for again.</p>
</div>
`;

/**
 * Show the setup screen until `accept(bytes)` resolves with SPRITES.LVL for a file the player gave.
 * accept throws with a readable message for files that cannot be used.
 */
export function askForGameFiles(accept) {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = CSS;
    const root = document.createElement('div');
    root.id = 'kknd-setup';
    root.innerHTML = HTML;
    document.head.appendChild(style);
    document.body.appendChild(root);

    const input = root.querySelector('input');
    const drop = root.querySelector('.drop');
    const status = root.querySelector('.status');
    let busy = false;

    const say = (text, error = false) => {
      status.textContent = text;
      status.classList.toggle('error', error);
    };

    async function use(file) {
      if (!file || busy) return;
      busy = true;
      say(`Reading ${file.name}...`);
      try {
        const lvl = await accept(new Uint8Array(await file.arrayBuffer()));
        say('Got it! Starting the battle...');
        root.remove();
        style.remove();
        resolve(lvl);
      } catch (e) {
        say(`${file.name}: ${e.message}. Please choose SPRITES.LVL or KKND_XT.EXE.`, true);
      } finally {
        busy = false;
      }
    }

    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') input.click();
    });
    input.addEventListener('change', () => use(input.files[0]));
    for (const t of [root, drop]) {
      t.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('over');
      });
      t.addEventListener('dragleave', () => drop.classList.remove('over'));
      t.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        use(e.dataTransfer.files[0]);
      });
    }
  });
}
