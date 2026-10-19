import { createLogger } from "./logger.js";

const logger = createLogger("QRGenerator");

// ============================================================================
// QR CODE GENERATOR
// Generates QR codes as data URLs for agent sharing
// ============================================================================

export interface QRCodeOptions {
    width?: number;
    height?: number;
    color?: {
        dark?: string;
        light?: string;
    };
    margin?: number;
    type?: "image/png" | "image/jpeg" | "image/webp";
    quality?: number; // 0-1 for JPEG/WEBP
}

export interface QRCodeResult {
    dataUrl: string;
    width: number;
    height: number;
    content: string;
}

// Check if qrcode package is available.
// No top-level await: this module is sometimes pulled in through a require() chain,
// where esbuild/tsx transforms it as CJS and top-level await is unsupported there.
let QRCode: any;
const qrCodeReady: Promise<void> = import("qrcode")
    .then((mod) => {
        QRCode = mod;
    })
    .catch(() => {
        logger.warn("qrcode package not available. QR generation will be disabled.");
    });

export const qrGenerator = {
    /**
     * Check if QR generation is available
     */
    isAvailable(): boolean {
        return QRCode !== undefined;
    },

    /**
     * Generate a QR code as a data URL
     */
    async generate(content: string, options: QRCodeOptions = {}): Promise<QRCodeResult | null> {
        await qrCodeReady;
        if (!this.isAvailable()) {
            logger.error("QR generation not available - qrcode package not installed");
            return null;
        }

        try {
            const width = options.width || 400;
            const height = options.height || 400;
            const type = options.type || "image/png";

            // Map our options to qrcode library options
            const qrOptions: any = {
                type,
                width,
                margin: options.margin ?? 4,
                color: {
                    dark: options.color?.dark || "#000000",
                    light: options.color?.light || "#FFFFFF",
                },
            };

            // Add quality for lossy formats
            if (type !== "image/png" && options.quality !== undefined) {
                qrOptions.quality = Math.round(options.quality * 10); // qrcode uses 0-10
            }

            const dataUrl = await QRCode.toDataURL(content, qrOptions);

            logger.info(`Generated QR code for: ${content.slice(0, 50)}...`);

            return {
                dataUrl,
                width,
                height,
                content,
            };
        } catch (error) {
            logger.error("Failed to generate QR code:", error);
            return null;
        }
    },

    /**
     * Generate a QR code buffer (for file storage)
     */
    async generateBuffer(content: string, options: QRCodeOptions = {}): Promise<Buffer | null> {
        await qrCodeReady;
        if (!this.isAvailable()) {
            logger.error("QR generation not available - qrcode package not installed");
            return null;
        }

        try {
            const width = options.width || 400;

            const qrOptions: any = {
                type: "png",
                width,
                margin: options.margin ?? 4,
                color: {
                    dark: options.color?.dark || "#000000",
                    light: options.color?.light || "#FFFFFF",
                },
            };

            const buffer = await QRCode.toBuffer(content, qrOptions);

            logger.info(`Generated QR code buffer for: ${content.slice(0, 50)}...`);

            return buffer;
        } catch (error) {
            logger.error("Failed to generate QR code buffer:", error);
            return null;
        }
    },

    /**
     * Generate SVG QR code (scalable, smaller size)
     */
    async generateSVG(content: string, options: Omit<QRCodeOptions, "type" | "quality"> = {}): Promise<string | null> {
        await qrCodeReady;
        if (!this.isAvailable()) {
            logger.error("QR generation not available - qrcode package not installed");
            return null;
        }

        try {
            const width = options.width || 400;

            const qrOptions: any = {
                type: "svg",
                width,
                margin: options.margin ?? 4,
                color: {
                    dark: options.color?.dark || "#000000",
                    light: options.color?.light || "#FFFFFF",
                },
            };

            const svg = await QRCode.toString(content, qrOptions);

            logger.info(`Generated SVG QR code for: ${content.slice(0, 50)}...`);

            return svg;
        } catch (error) {
            logger.error("Failed to generate SVG QR code:", error);
            return null;
        }
    },

    /**
     * Generate QR code for a published agent
     */
    async generateForAgent(
        agentSlug: string,
        baseUrl: string,
        options: QRCodeOptions = {}
    ): Promise<QRCodeResult | null> {
        const url = `${baseUrl}/a/${agentSlug}`;
        return this.generate(url, options);
    },

    /**
     * Generate QR code for a shortlink
     */
    async generateForShortlink(
        code: string,
        baseUrl: string,
        options: QRCodeOptions = {}
    ): Promise<QRCodeResult | null> {
        const url = `${baseUrl}/s/${code}`;
        return this.generate(url, options);
    },

    /**
     * Create a styled QR code with logo/text overlay (requires canvas - more complex)
     * For now, returns a standard QR with branding colors
     */
    async generateStyled(
        content: string,
        branding: {
            primaryColor: string;
            backgroundColor?: string;
            logoUrl?: string; // Future: overlay logo
            title?: string; // Future: embed title
        },
        options: QRCodeOptions = {}
    ): Promise<QRCodeResult | null> {
        const styledOptions: QRCodeOptions = {
            ...options,
            color: {
                dark: branding.primaryColor,
                light: branding.backgroundColor || "#FFFFFF",
            },
        };

        return this.generate(content, styledOptions);
    },
};

export default qrGenerator;
