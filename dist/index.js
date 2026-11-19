"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closest = exports.checkScript = void 0;
// SPDX-License-Identifier: LGPL-3.0-or-later
__exportStar(require("./table"), exports);
__exportStar(require("./parser"), exports);
__exportStar(require("./names"), exports);
__exportStar(require("./extract"), exports);
__exportStar(require("./project"), exports);
__exportStar(require("./rules"), exports);
__exportStar(require("./values"), exports);
__exportStar(require("./fix"), exports);
__exportStar(require("./config"), exports);
__exportStar(require("./directives"), exports);
var core_1 = require("./core");
Object.defineProperty(exports, "checkScript", { enumerable: true, get: function () { return core_1.checkScript; } });
Object.defineProperty(exports, "closest", { enumerable: true, get: function () { return core_1.closest; } });
__exportStar(require("./events"), exports);
//# sourceMappingURL=index.js.map