// file API functions
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => resolve(new Uint8Array(event.target.result));
        reader.onerror = (error) => reject(error);

        reader.readAsArrayBuffer(file);
    });
}

function writeFile(data) {
    return new Promise((resolve) => {
        const blob = new Blob([data], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);

        resolve(url);
    });
}

// current file position
var offset;

// (un)packing functions
function packInteger(array, value) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);

    view.setUint32(0, value, true);
    array.set(new Uint8Array(buffer), offset);

    offset += 4;
}

function unpackInteger(array) {
    const slice = array.slice(offset, offset += 4);
    const view = new DataView(slice.buffer);

    return view.getUint32(0, true);
}

function unpackULEB128(array) {
    if (array[offset++] !== 0x0b) {
        throw new Error("Invalid ULEB128 prefix.");
    }

    let value = 0;
    let shift = 0;

    while (true) {
        const byte = array[offset++];

        value += (byte & 0x7f) << shift;
        shift += 7;

        if ((byte & 0x80) === 0) {
            break;
        }
    }

    return value;
}

// unrelaxifying functions
function unrelaxifyLegacy(data) {
    offset = unpackULEB128(data) + offset; // beatmap hash
    offset = unpackULEB128(data) + offset; // player name
    offset = unpackULEB128(data) + offset; // replay hash

    offset += 2 * 6; // 300s, 100s, 50s, gekis, katus, misses
    offset += 4 + 2 + 1; // score, combo, PFC

    let mods = unpackInteger(data); // mods (stable)

    if ((mods & 0x80) === 0) {
        throw new Error("Relax mod not found in the replay file.");
    }

    mods &= ~0x80;
    offset -= 4;

    packInteger(data, mods);
}

function unrelaxifyLazer(data) {
    offset = unpackULEB128(data) + offset; // life bar graph
    offset += 8; // timestamp
    offset = unpackInteger(data) + offset; // replay data
    offset += 8; // score ID

    const length = unpackInteger(data); // lazer metadata length
    let metadata = data.slice(offset, offset + length); // lazer metadata

    metadata = LZMA.decompress(metadata);
    metadata = JSON.parse(metadata);

    if (metadata.mods.some(mod => mod.acronym === "RX")) {
        metadata.mods = metadata.mods.filter(mod => mod.acronym !== "RX");
    } else {
        throw new Error("Relax mod not found in the replay file.");
    }

    metadata = JSON.stringify(metadata);
    metadata = LZMA.compress(metadata, 1);

    offset -= 4;

    packInteger(data, metadata.length);
    data.set(new Uint8Array(metadata), offset);
}

// constants
const input = document.getElementById("file-input");
const button = document.getElementById("unrelaxify-button");

// event listeners
input.addEventListener("change", () => {
    if (input.files.length > 0) {
        button.disabled = false;
    }
});

button.addEventListener("click", async () => {
    offset = 1;  // game mode

    const file = input.files[0];
    const data = await readFile(file);

    const version = unpackInteger(data);

    try {
        unrelaxifyLegacy(data);

        if (version >= 30000001) {
            unrelaxifyLazer(data);
        }
    } catch (error) {
        document.body.insertAdjacentHTML("beforeend", `<p>${error}</p>`); return;
    }

    const url = await writeFile(data);
    const name = file.name.replace(".osr", "_unrelaxified.osr");

    document.body.insertAdjacentHTML("beforeend", `<p>Done! <a href="${url}" download="${name}">Download</a> the modified replay file (${name}, ${data.length} bytes).</p>`);
});