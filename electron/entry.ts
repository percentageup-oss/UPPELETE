import { EXPORT_HOST_FLAG } from './exportHostFlag'

// Packaged Electron ignores a script path in argv, so the export host is selected by flag: the same
// executable runs either the caption-frame host or the editor.
if (process.argv.includes(EXPORT_HOST_FLAG)) require('../dist-export/host.cjs')
else require('./main.cjs')
