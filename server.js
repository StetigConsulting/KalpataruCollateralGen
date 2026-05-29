const express = require("express");
const multer = require("multer");

const {
  PDFDocument,
  rgb,
  StandardFonts,
} = require("pdf-lib");

const app = express();

// =========================================
// MULTER MEMORY STORAGE
// =========================================

const storage =
  multer.memoryStorage();

const upload =
  multer({
    storage,
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
  });

// =========================================
// API
// =========================================

app.post(
  "/generate-pdf",
  upload.single("pdf"),
  async (req, res) => {

    try {

      // =====================================
      // VALIDATION
      // =====================================

      if (!req.file) {

        return res.status(400).json({
          error: "PDF file required",
        });
      }

      // =====================================
      // REQUEST DATA
      // =====================================

      const {
        companyName,
        phone,
        address,
      } = req.body;

      // =====================================
      // LOAD INPUT PDF
      // =====================================

      const originalPdf =
        await PDFDocument.load(
          req.file.buffer
        );

      // =====================================
      // CREATE NEW PDF
      // =====================================

      const newPdf =
        await PDFDocument.create();

      // =====================================
      // COPY PAGES
      // =====================================

      const copiedPages =
        await newPdf.copyPages(
          originalPdf,
          originalPdf.getPageIndices()
        );

      // =====================================
      // LOAD LOGO
      // =====================================

      const fs = require("fs");
      const path = require("path");

      const logoBytes =
        fs.readFileSync(
          path.join(
            __dirname,
            "logo.png"
          )
        );

      const logoImage =
        await newPdf.embedPng(
          logoBytes
        );

      // =====================================
      // FONTS
      // =====================================

      const titleFont =
        await newPdf.embedFont(
          StandardFonts.TimesRomanBold
        );

      const normalFont =
        await newPdf.embedFont(
          StandardFonts.TimesRoman
        );

      // =====================================
      // HEADER CONFIG
      // =====================================

      const HEADER_HEIGHT = 90;

      // =====================================
      // PROCESS PAGES
      // =====================================

      for (const originalPage of copiedPages) {

        const {
          width,
          height,
        } = originalPage.getSize();

        // ===================================
        // CREATE NEW PAGE
        // ===================================

        const page =
          newPdf.addPage([
            width,
            height + HEADER_HEIGHT,
          ]);

        const HEADER_Y = height;

        // ===================================
        // HEADER BACKGROUND
        // ===================================

        page.drawRectangle({

          x: 0,

          y: HEADER_Y,

          width,

          height: HEADER_HEIGHT,

          color: rgb(
            0.975,
            0.975,
            0.975
          ),
        });

        // ===================================
        // TOP BLUE BAR
        // ===================================

        page.drawRectangle({

          x: 0,

          y:
            HEADER_Y +
            HEADER_HEIGHT -
            5,

          width,

          height: 5,

          color: rgb(
            0.12,
            0.35,
            0.65
          ),
        });

        // ===================================
        // LOGO
        // ===================================

        const logoX = 30;

        const logoSize = 60;

        const logoY =
          HEADER_Y +
          (HEADER_HEIGHT -
            logoSize) /
            2;

        page.drawImage(
          logoImage,
          {

            x: logoX,

            y: logoY,

            width: logoSize,

            height: logoSize,
          }
        );

        // ===================================
        // TEXT ALIGNMENT
        // ===================================

        const textX =
          logoX +
          logoSize +
          22;

        const logoCenterY =
          logoY +
          logoSize / 2;

        const totalTextHeight =
          42;

        const firstRowY =
          logoCenterY +
          totalTextHeight / 2 -
          10;

        const rowGap = 16;

        // ===================================
        // COMPANY NAME
        // ===================================

        page.drawText(
          companyName ||
            "ABC Technologies Pvt Ltd",
          {

            x: textX,

            y: firstRowY,

            size: 18,

            font: titleFont,

            color: rgb(
              0.1,
              0.1,
              0.1
            ),
          }
        );

        // ===================================
        // PHONE
        // ===================================

        page.drawText(
          phone ||
            "+91 9876543210",
          {

            x: textX,

            y:
              firstRowY -
              rowGap,

            size: 11,

            font: normalFont,

            color: rgb(
              0.38,
              0.38,
              0.38
            ),
          }
        );

        // ===================================
        // ADDRESS
        // ===================================

        page.drawText(
          address ||
            "Baner Road, Pune",
          {

            x: textX,

            y:
              firstRowY -
              rowGap * 2,

            size: 11,

            font: normalFont,

            color: rgb(
              0.38,
              0.38,
              0.38
            ),
          }
        );

        // ===================================
        // DIVIDER LINE
        // ===================================

        page.drawLine({

          start: {
            x: 20,
            y: HEADER_Y,
          },

          end: {
            x: width - 20,
            y: HEADER_Y,
          },

          thickness: 1,

          color: rgb(
            0.82,
            0.82,
            0.82
          ),
        });

        // ===================================
        // DRAW ORIGINAL PAGE
        // ===================================

        const embeddedPage =
          await newPdf.embedPage(
            originalPage
          );

        page.drawPage(
          embeddedPage,
          {

            x: 0,

            y: 0,

            width,

            height,
          }
        );
      }

      // =====================================
      // SAVE PDF
      // =====================================

      const finalPdfBytes =
        await newPdf.save({

          useObjectStreams: false,
        });

      // =====================================
      // RESPONSE
      // =====================================

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="generated.pdf"'
      );

      return res.send(
        Buffer.from(finalPdfBytes)
      );

    } catch (error) {

      console.log(error);

      return res.status(500).json({
        error: error.message,
      });
    }
  }
);

// =========================================
// HEALTH CHECK
// =========================================

app.get("/", (req, res) => {

  res.send("PDF API Running");
});

// =========================================
// START SERVER
// =========================================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );
});