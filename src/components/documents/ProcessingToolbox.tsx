export default function ProcessingToolbox() {
  return (
    <div className="h-full bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-2 flex flex-col">
      <h2 className="text-xs font-semibold text-gray-900 dark:text-white mb-2">Tools</h2>

      <div className="space-y-1.5 flex-1 overflow-auto">
        {/* Rotation */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Rotation
          </label>
          <div className="flex gap-1">
            <button className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              ↶ 90°
            </button>
            <button className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              ↷ -90°
            </button>
          </div>
        </div>

        {/* Flip */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Flip
          </label>
          <div className="flex gap-1">
            <button className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              ↔ H
            </button>
            <button className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              ↕ V
            </button>
          </div>
        </div>

        {/* Crop */}
        <div>
          <button className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition font-medium text-gray-700 dark:text-gray-300">
            🔲 Crop
          </button>
        </div>

        {/* Filter */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
            Filter
          </label>
          <select className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
            <option>None</option>
            <option>Grayscale</option>
            <option>Sepia</option>
            <option>Invert</option>
            <option>Brightness</option>
            <option>Contrast</option>
          </select>
        </div>

        {/* OCR */}
        <div>
          <button className="w-full px-2 py-1 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded transition font-medium">
            📝 OCR
          </button>
        </div>

        {/* Reset */}
        <div>
          <button className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition font-medium text-gray-700 dark:text-gray-300">
            ↺ Reset
          </button>
        </div>
      </div>
    </div>
  );
}
