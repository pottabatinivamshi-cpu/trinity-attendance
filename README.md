# Trinity Attendance Letters

A site for making DJS Trinity '27 attendance letters.

Pick people from a list or upload a file, add the subject and attendance dates, and download the letter as a PDF. The letterhead and the signature block (Top Core, Convener and Co-Convener) are the same on every letter.

## What's on the site

- **Trinity Team**: Core (TE) and Co-Com (SE) by department.
- **Just for today's letter** (Trinity Team, core only): add people who aren't on the list straight onto the Trinity letter. They're kept on that phone only, can be edited or removed, and are cleared at midnight. Nothing is saved to the database.
- **IDPT Sports**: captains, co-captains and players, branch by branch, with its own letter. **Add a whole group** adds, say, every captain and co-captain at once.
- **Events**: core makes any event by name. Each event works like IDPT Sports, with its own list, QR sign-up (`join.html?e=<event>`) and letter.
- **Timing column** (any letter): switch it on to add a Timing column. Set one slot for everyone (8:00 AM to 6:00 PM, half-hour steps), then change single students or a ticked group. A Quick letter file with a Time / Timing / Slot column fills it in.
- **Quick letter**: upload any CSV or Excel file with one student per row, add the subject, and download. Nothing is saved to the lists.
- **Records** (top right, core only): every downloaded letter, by attendance date. Search a student to see every day they got attendance, see who was on each letter, download it again, or delete the record.

## Privacy

The lists hold students' names, roll numbers and SAP IDs, so they aren't public:

- Opening the site needs the **view PIN** (or the core PIN). Core sets the view PIN under **Records → View PIN**. Changing it asks every phone for the new one.
- Editing, deleting and Records need the **core PIN**.
- Both PINs are checked inside the database. After 10 wrong PINs, PIN entry is locked for 15 minutes.
- No student data is kept in this repo.

## Core tools

- **✎ Edit** any person's details. On Trinity Team the change shows in every department they're in.
- **−** deletes someone from a list. Deleted names go to the bin, where you can **Restore** them, **Delete forever**, or **Empty bin**.
- **IDPT and events**: share the **QR code** (sign-ups wait for approval), **Add at the desk**, or **Import CSV / Excel**. Branch and year fill in from the SAP ID.

## How it works

- Everything runs in the browser. The lists live in a free [Supabase](https://supabase.com) database.
- The PDF is made in the browser with [jsPDF](https://github.com/parallax/jsPDF) and [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable), kept in `vendor/`.
- A GitHub Action pings the database every 3 days so the free project doesn't pause.

## Setting up the database (once)

1. Create a free project at supabase.com.
2. In **SQL Editor**, run these in order: `supabase/setup.sql`, `idpt.sql`, `events.sql`, `purge.sql`, `security.sql`.
3. Run `supabase/set-pin.sql` with your core PIN in place of `CHANGE-ME`. Don't commit your real PIN.
4. Put the project URL and the publishable key in `config.js`.
5. Load the member lists from your CSVs, then set the view PIN from the site.
