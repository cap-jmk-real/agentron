# Windows code signing (remove "Unknown publisher")

The desktop app is built with **copyright** and **publisherName** set to **Julian M. Kleber**, so you are identified as the developer in the executable properties and installer. Without a **code signing certificate**, Windows Defender SmartScreen will still show "Unknown publisher" when users run the installer or app.

To remove that warning and show your name as the verified publisher:

1. **Obtain a code signing certificate** (e.g. from DigiCert, Sectigo, or another CA). Options:
   - **EV (Extended Validation)** — SmartScreen trust immediately; certificate usually on a USB hardware token.
   - **Standard code signing** — Lower cost; SmartScreen warning decreases as more users install.

2. **Export your certificate** as a `.pfx` file (if not EV) and set these environment variables when building:
   ```bash
   set CSC_LINK=C:\path\to\your-certificate.pfx
   set CSC_KEY_PASSWORD=your-certificate-password
   npm run dist:desktop
   ```
   On PowerShell:
   ```powershell
   $env:CSC_LINK = "C:\path\to\your-certificate.pfx"
   $env:CSC_KEY_PASSWORD = "your-certificate-password"
   npm run dist:desktop
   ```

3. **Publisher name:** When you sign, the publisher shown in Windows is taken from your certificate’s Subject Name (e.g. CN). The app’s **copyright** in `package.json` (`build.copyright`) is embedded in the executable properties and identifies you as the developer.

See [electron-builder Windows code signing](https://www.electron.build/code-signing-win.html) for more options (e.g. Azure Trusted Signing).
