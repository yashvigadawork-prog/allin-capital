-- The criteria. Loads only into an empty table, so rerunning never undoes or duplicates edits made on the settings page.
-- Wording is paraphrased from the cited pages, not quoted. The fifth one comes from partner meeting 3 (score the evidence for
-- reaching customers, separately from founder pedigree). decisive_fields are the extracted facts that must be stated for the
-- criterion to be scored without a cap: see settings "missing_evidence_cap".
insert into criteria (name, definition, source_url, decisive_fields)
select * from (values
  ('Why now',
   'One named change that makes the idea possible now: a new technology, a regulatory shift, or a change in consumer behaviour.',
   'https://inc42.com/features/kushal-baghia-all-in-capital-founder-market-fit-framework-pre-seed-investing/',
   array['why_now']),
  ('Founder-market fit',
   'The founder''s past work in this space, and one insight outsiders would not know (an "earned secret").',
   'https://inc42.com/features/kushal-baghia-all-in-capital-founder-market-fit-framework-pre-seed-investing/',
   array['founders']),
  ('Ability to build',
   'For first-time founders: a launched product, or a past role running a product at scale.',
   'https://inc42.com/features/kushal-baghia-all-in-capital-founder-market-fit-framework-pre-seed-investing/',
   array['product']),
  ('Team and commitment',
   'How long the founders have worked together, whether they work on this full time, and any sign of staying power.',
   'https://inc42.com/features/kushal-baghia-all-in-capital-founder-market-fit-framework-pre-seed-investing/',
   array['team_start_dates', 'full_time_status']),
  ('Path to market',
   'Evidence of how the company will reach its first customers and grow: who buys, how they are reached, and what early traction shows. Judged on evidence, separate from the founders'' pedigree.',
   null,
   array['market', 'traction'])
) as v(name, definition, source_url, decisive_fields)
where not exists (select 1 from criteria);

-- Placeholder rupee rate, not a quoted market rate. Set today's rate on the Criteria page.
insert into settings (key, value) values ('usd_inr', '90') on conflict (key) do nothing;

-- Scoring rules, all partner decisions still open. Change them on the Criteria and settings page.
-- missing_evidence_cap: a criterion whose decisive fact is not stated is capped at this score. 0 = never cap (gap only).
insert into settings (key, value) values ('missing_evidence_cap', '2') on conflict (key) do nothing;
-- Sectors the partners may not back. Flagged for Riya, never rejected.
insert into settings (key, value) values ('out_of_scope_sectors', 'Web3, crypto') on conflict (key) do nothing;
-- Words that suggest deeptech, where the partners take the second call.
insert into settings (key, value) values ('deeptech_keywords', 'deeptech, deep tech, robotics, space, semiconductor, hardware, biotech, quantum') on conflict (key) do nothing;

-- The fund's public portfolio, copied from https://www.allincapital.vc/portfolio on 21 Nov 2026 (descriptions shortened).
-- The partners must confirm it is complete: the page is public marketing, not their books. Loads only into an empty table.
insert into portfolio_companies (name, description, source_url)
select * from (values
  ('Tross', 'Healthcare. Infrastructure and API integrations for electronic health records and payer portals.', 'https://www.allincapital.vc/portfolio'),
  ('SuperLiving', 'Consumer tech. Lifestyle app for Indian families.', 'https://www.allincapital.vc/portfolio'),
  ('Taakat', 'Consumer brand. Whole-food products for the masses.', 'https://www.allincapital.vc/portfolio'),
  ('Medmitra AI', 'SaaS. AI decision support for doctors: differential diagnosis and prognosis.', 'https://www.allincapital.vc/portfolio'),
  ('Ionic', 'Consumer brand. Professional damage-reversal haircare, salon-first go-to-market.', 'https://www.allincapital.vc/portfolio'),
  ('Spill Games', 'Consumer tech. Casual and hybrid-casual mobile game studio.', 'https://www.allincapital.vc/portfolio'),
  ('Krvvy', 'Consumer brand. Intimates, shapewear and lifestyle brand.', 'https://www.allincapital.vc/portfolio'),
  ('NPrep', 'Consumer tech. Nursing exam preparation platform (NORCET).', 'https://www.allincapital.vc/portfolio'),
  ('Mixar', 'SaaS. Text-to-3D model builder.', 'https://www.allincapital.vc/portfolio'),
  ('Plazza', 'Consumer tech. Quick commerce for medicines.', 'https://www.allincapital.vc/portfolio'),
  ('Cherry', 'Consumer tech. Shopping app exclusively for creators.', 'https://www.allincapital.vc/portfolio'),
  ('Returns', 'Fintech. Options trading made simple.', 'https://www.allincapital.vc/portfolio'),
  ('MomsMade', 'Consumer brand. Clean-label regional snacks, Bihari cuisine.', 'https://www.allincapital.vc/portfolio'),
  ('NewMe', 'India consumer. Fast fashion brand.', 'https://www.allincapital.vc/portfolio'),
  ('PierSight', 'Deeptech, space. Synthetic aperture radar systems.', 'https://www.allincapital.vc/portfolio'),
  ('MeetRecord', 'SaaS. Meeting intelligence and sales coaching for US small businesses.', 'https://www.allincapital.vc/portfolio'),
  ('Broccoli AI', 'AI-native operating system for home service businesses.', 'https://www.allincapital.vc/portfolio'),
  ('Potpie', 'Custom agents for your codebase.', 'https://www.allincapital.vc/portfolio'),
  ('Volt', 'Fintech. Loans against mutual funds and securities, consumer app for India.', 'https://www.allincapital.vc/portfolio'),
  ('Vaaree', 'India consumer. B2C home and decor marketplace.', 'https://www.allincapital.vc/portfolio'),
  ('Hotelzify', 'Travel, SaaS. Software for small hotels.', 'https://www.allincapital.vc/portfolio'),
  ('SuprSend', 'SaaS. Notification infrastructure for products.', 'https://www.allincapital.vc/portfolio'),
  ('Magma', 'B2B marketplace. Cross-border marketplace for ceramics and construction chemicals.', 'https://www.allincapital.vc/portfolio'),
  ('SuperNova', 'Edtech. AI tutor for English.', 'https://www.allincapital.vc/portfolio'),
  ('Sketchnote', 'SaaS. Startup operating system.', 'https://www.allincapital.vc/portfolio'),
  ('GloRoots', 'SaaS. Global employer-of-record and payroll platform.', 'https://www.allincapital.vc/portfolio'),
  ('Suite42', 'B2B marketplace. On-demand manufacturing for packaged food.', 'https://www.allincapital.vc/portfolio'),
  ('Produze', 'B2B marketplace. Helps Indian brands sell in foreign marketplaces.', 'https://www.allincapital.vc/portfolio'),
  ('Rocketpay', 'Fintech. Peer-to-peer NACH mandates for collecting money back.', 'https://www.allincapital.vc/portfolio'),
  ('EximFiles', 'SaaS. Generates the shipping documents a business needs for an export or import shipment.', 'https://www.allincapital.vc/portfolio'),
  ('SalesMonk', 'SaaS. AI pipeline generation.', 'https://www.allincapital.vc/portfolio'),
  ('GigaFun Studios', 'Gaming. Localized match-3 puzzle games for India.', 'https://www.allincapital.vc/portfolio'),
  ('Dashwave', 'Dev tools. Cloud platform for mobile developers.', 'https://www.allincapital.vc/portfolio'),
  ('MoMoney', 'Fintech. Investment app for Gen Z in India.', 'https://www.allincapital.vc/portfolio'),
  ('Hectar', 'B2B marketplace. Cross-border marketplace for agri commodities.', 'https://www.allincapital.vc/portfolio'),
  ('Knot', 'Social. App for teens to share positive feedback.', 'https://www.allincapital.vc/portfolio'),
  ('Mannjal', 'Fintech. Lending as a service for B2B marketplaces.', 'https://www.allincapital.vc/portfolio'),
  ('Nawgati', 'SaaS, climate. Compliance and operations software for fuelling stations.', 'https://www.allincapital.vc/portfolio'),
  ('FanTail', 'B2B marketplace. Man-made fabrics.', 'https://www.allincapital.vc/portfolio'),
  ('DressFolk', 'D2C. Handwoven ethnic wear brand.', 'https://www.allincapital.vc/portfolio'),
  ('DevDham', 'India consumer. Platform bringing temples online and connecting them to devotees.', 'https://www.allincapital.vc/portfolio'),
  ('REint', 'SaaS, climate. AI supply prediction for renewable energy markets.', 'https://www.allincapital.vc/portfolio'),
  ('Segmind', 'SaaS, generative AI. APIs for generative AI models.', 'https://www.allincapital.vc/portfolio'),
  ('Arva', 'India consumer, healthcare. Women''s health and fertility brand focused on egg freezing.', 'https://www.allincapital.vc/portfolio'),
  ('Salty', 'D2C. Fashion accessories brand for Gen Z.', 'https://www.allincapital.vc/portfolio'),
  ('Nirmaan', 'B2B marketplace. Construction materials, small brands to retailers.', 'https://www.allincapital.vc/portfolio'),
  ('Karban', 'India consumer, deeptech. Fan, light and air purifier in one device.', 'https://www.allincapital.vc/portfolio'),
  ('Mave Health', 'Healthcare. Wearable device and coaching for depression and mental health.', 'https://www.allincapital.vc/portfolio'),
  ('Trisu', 'D2C. Fine jewellery brand.', 'https://www.allincapital.vc/portfolio'),
  ('Grid', 'Manufacturing, B2B. Original design manufacturer for IoT products in India.', 'https://www.allincapital.vc/portfolio'),
  ('FuturElectra', 'EV, fintech. Lifecycle management platform for electric two-wheelers.', 'https://www.allincapital.vc/portfolio'),
  ('BindBee', 'SaaS, dev tools. Unified API for people data.', 'https://www.allincapital.vc/portfolio'),
  ('Prosparity', 'EV, fintech. EV financing NBFC.', 'https://www.allincapital.vc/portfolio'),
  ('MagicStudio', 'Generative AI, SaaS. AI photo editing app for small businesses.', 'https://www.allincapital.vc/portfolio'),
  ('Everyday', 'India consumer. Lab-grown diamond brand.', 'https://www.allincapital.vc/portfolio'),
  ('Creatr', 'Generative AI, SaaS. AI-led design tool.', 'https://www.allincapital.vc/portfolio'),
  ('TractorFactory', 'India consumer, agritech. Omnichannel marketplace for second-hand tractors.', 'https://www.allincapital.vc/portfolio'),
  ('Viralme', 'B2B marketplace. Sourcing platform for online arbitrage resellers.', 'https://www.allincapital.vc/portfolio'),
  ('CommandK', 'Dev tools. DPDP and GDPR management software for tech companies.', 'https://www.allincapital.vc/portfolio'),
  ('Spiti', 'SaaS. Private video platform for teams.', 'https://www.allincapital.vc/portfolio'),
  ('Suitable', 'SaaS. Employee referral management platform.', 'https://www.allincapital.vc/portfolio'),
  ('Piiko', 'Healthcare. Much cheaper blood testing machines for India.', 'https://www.allincapital.vc/portfolio'),
  ('Vivahit', 'India consumer. App for organising weddings and guest experience.', 'https://www.allincapital.vc/portfolio'),
  ('Fijit', 'Gaming. Hyper-casual play-to-earn Web3 meme games.', 'https://www.allincapital.vc/portfolio'),
  ('Rocketlane', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('Wint Wealth', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('SuperK', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('Mailmodo', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('FleetX', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('Fashinza', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('Giva', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('Jai Kisan', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('Rigi', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('QuestionBook', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio'),
  ('Unbox Robotics', 'Past portfolio company. No description on the page.', 'https://www.allincapital.vc/portfolio')
) as v(name, description, source_url)
where not exists (select 1 from portfolio_companies)
