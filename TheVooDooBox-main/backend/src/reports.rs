use genpdf::{elements, style, Element, Alignment};
use crate::ai_analysis::{ForensicReport, AnalysisContext, AIReport};
use serde_json;

fn get_asset_path(relative: &str) -> String {
    let paths = vec![
        format!("/app/{}", relative), // Docker container primary
        format!("./{}", relative),    // Active root
        format!("./backend/{}", relative), // Local dev root
    ];
    for p in paths {
        if std::path::Path::new(&p).exists() {
            println!("[PDF] Found asset at: {}", p);
            return p;
        }
    }
    println!("[PDF] WARNING: Asset not found: {}", relative);
    format!("./{}", relative) // Fallback
}

pub fn generate_pdf_file(_task_id: &String, report: &ForensicReport, context: &AnalysisContext) -> Result<Vec<u8>, genpdf::error::Error> {
    let font_dir = get_asset_path("assets/fonts");
    println!("[PDF] Loading fonts from: {}", font_dir);

    // Manual font loading to pinpoint errors
    let load_font = |name: &str| -> Result<Vec<u8>, genpdf::error::Error> {
        let path = format!("{}/{}", font_dir, name);
        std::fs::read(&path).map_err(|e| {
            println!("[PDF] Failed to read {}: {}", path, e);
            genpdf::error::Error::new(format!("IO Error for {}: {}", name, e), e)
        })
    };

    let regular_data = load_font("Roboto-Regular.ttf")?;
    let bold_data = load_font("Roboto-Bold.ttf")?;
    let italic_data = load_font("Roboto-Italic.ttf")?;
    let bold_italic_data = load_font("Roboto-BoldItalic.ttf")?;

    let font_family = genpdf::fonts::FontFamily {
        regular: genpdf::fonts::FontData::new(regular_data, None).map_err(|e| { println!("[PDF] Bad Font Data (Reg): {}", e); e })?,
        bold: genpdf::fonts::FontData::new(bold_data, None).map_err(|e| { println!("[PDF] Bad Font Data (Bold): {}", e); e })?,
        italic: genpdf::fonts::FontData::new(italic_data, None).map_err(|e| { println!("[PDF] Bad Font Data (Italic): {}", e); e })?,
        bold_italic: genpdf::fonts::FontData::new(bold_italic_data, None).map_err(|e| { println!("[PDF] Bad Font Data (BoldItalic): {}", e); e })?,
    };
        
    let mut doc = genpdf::Document::new(font_family);
    doc.set_title("VooDooBox Forensic Report");

    // Page Decorator with Logo
    let mut decorator = genpdf::SimplePageDecorator::new();
    decorator.set_margins(15);
    doc.set_page_decorator(decorator);

    // --- HEADER (Side-by-Side Logo and Title) ---
    // Increased logo column weight to maximize visibility of the slogan
    let mut header_table = elements::TableLayout::new(vec![8, 1]); 
    
    // Column 1: Logo
    let logo_path = get_asset_path("assets/logo.png");
    
    let logo_element: Box<dyn Element> = if let Ok(img) = image::open(&logo_path) {
        println!("[PDF] Logo image opened successfully. ColorType: {:?}", img.color());
        // Maximum dimensions to ensure the bottom slogan is crisp and readable
        let resized = img.resize(1600, 600, image::imageops::FilterType::Lanczos3);
        
        // Convert to RGB8 to ensure maximum compatibility with genpdf/PDF specs (removes alpha)
        let rgb8_img = resized.to_rgb8();
        let final_img = image::DynamicImage::ImageRgb8(rgb8_img);
        
        match elements::Image::from_dynamic_image(final_img) {
            Ok(image_element) => {
                println!("[PDF] elements::Image::from_dynamic_image succeeded");
                Box::new(image_element.with_alignment(Alignment::Left))
            },
            Err(e) => {
                println!("[PDF] ERROR: elements::Image::from_dynamic_image failed: {}", e);
                Box::new(elements::Paragraph::new(format!("[VOODOOBOX_LOGO_GEN_ERROR: {}]", e)))
            }
        }
    } else {
        println!("[PDF] ERROR: Failed to open logo image at {}", logo_path);
         Box::new(elements::Paragraph::new("[VOODOOBOX_LOGO_MISSING]"))
    };

    // Column 2: Title & Metadata
    let title_block = elements::Paragraph::new("FORENSIC TRIAGE REPORT")
        .aligned(Alignment::Right)
        .styled(style::Style::new().bold().with_font_size(18).with_color(style::Color::Rgb(50, 50, 50)));
    
    let date_str = chrono::Utc::now().format("%Y-%m-%d %H:%M UTC").to_string();
    let meta_block = elements::Paragraph::new(format!("Generated: {}\nTask ID: {}", date_str, _task_id))
        .aligned(Alignment::Right)
        .styled(style::Style::new().italic().with_font_size(8).with_color(style::Color::Rgb(100, 100, 100)));

    let mut right_col = elements::LinearLayout::vertical();
    right_col.push(title_block);
    right_col.push(meta_block);

    let _ = header_table.push_row(vec![ logo_element, Box::new(right_col) ]);
    doc.push(header_table);
    
    doc.push(elements::Break::new(2.0));

    // --- INCIDENT SUMMARY PANEL ---
    let summary_style = style::Style::new().bold().with_font_size(14);
    doc.push(elements::Paragraph::new("Incident Summary").styled(summary_style));
    doc.push(elements::Break::new(0.5));
    
    // Risk Panel Table
    let mut risk_panel = elements::TableLayout::new(vec![2, 5]);
    risk_panel.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
    
    let verdict_color = match report.verdict {
        crate::ai_analysis::Verdict::Malicious => style::Color::Rgb(220, 38, 38), // Red
        crate::ai_analysis::Verdict::Suspicious => style::Color::Rgb(234, 88, 12), // Orange
        crate::ai_analysis::Verdict::Benign => style::Color::Rgb(22, 163, 74), // Green
    };

    let _ = risk_panel.push_row(vec![
        Box::new(elements::Paragraph::new("VERDICT").styled(style::Style::new().bold())),
        Box::new(elements::Paragraph::new(format!("{:?}", report.verdict)).styled(style::Style::new().bold().with_font_size(12).with_color(verdict_color)))
    ]);
    let _ = risk_panel.push_row(vec![
        Box::new(elements::Paragraph::new("Threat Score").styled(style::Style::new().bold())),
        Box::new(elements::Paragraph::new(format!("{}/100", report.threat_score)))
    ]);
    let _ = risk_panel.push_row(vec![
        Box::new(elements::Paragraph::new("Malware Family").styled(style::Style::new().bold())),
        Box::new(elements::Paragraph::new(report.malware_family.clone().unwrap_or_else(|| "Unknown".to_string())))
    ]);
    let _ = risk_panel.push_row(vec![
        Box::new(elements::Paragraph::new("Digital Signature").styled(style::Style::new().bold())),
        Box::new(elements::Paragraph::new(context.digital_signature.clone().unwrap_or_else(|| "Not Checked".to_string())).styled(style::Style::new().italic().with_font_size(8)))
    ]);
    
    doc.push(risk_panel);
    doc.push(elements::Break::new(1.0));
    
    // Executive Summary Text
    doc.push(elements::Paragraph::new("Technical Narrative").styled(style::Style::new().bold().with_font_size(11)));
    doc.push(elements::Paragraph::new(&report.executive_summary).styled(style::Style::new().italic()));
    doc.push(elements::Break::new(1.0));
 
    // --- FORENSIC REASONING (Optional "Thinking" field) ---
    if let Some(think) = &report.thinking {
        doc.push(elements::Paragraph::new("Forensic Analyst Log (Internal Reasoning)").styled(style::Style::new().bold().with_font_size(11).with_color(style::Color::Rgb(100, 100, 100))));
        doc.push(elements::Break::new(0.5));
        
        // Styled box for reasoning with monospace font feel (if possible via style)
        let reasoning_style = style::Style::new()
            .with_font_size(9)
            .with_color(style::Color::Rgb(80, 80, 80));
            
        let mut reasoning_panel = elements::LinearLayout::vertical();
        reasoning_panel.push(elements::Paragraph::new(think).styled(reasoning_style));
        
        doc.push(reasoning_panel);
        doc.push(elements::Break::new(2.0));
    } else {
        doc.push(elements::Break::new(1.0));
    }

    // --- THREAT INTELLIGENCE (VirusTotal) ---
    if let Some(vt) = &context.virustotal {
        doc.push(elements::Paragraph::new("Threat Intelligence (VirusTotal)").styled(summary_style));
        doc.push(elements::Break::new(0.5));

        let mut vt_table = elements::TableLayout::new(vec![3, 9]);
        vt_table.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
        
        let score_color = if vt.malicious_votes > 0 { style::Color::Rgb(220, 38, 38) } else { style::Color::Rgb(22, 163, 74) };
        let _ = vt_table.push_row(vec![
            Box::new(elements::Paragraph::new("Detections").styled(style::Style::new().bold())),
            Box::new(elements::Paragraph::new(format!("{}", vt.malicious_votes)).styled(style::Style::new().bold().with_color(score_color)))
        ]);
        let _ = vt_table.push_row(vec![
            Box::new(elements::Paragraph::new("Threat Label").styled(style::Style::new().bold())),
            Box::new(elements::Paragraph::new(&vt.threat_label))
        ]);
         let _ = vt_table.push_row(vec![
            Box::new(elements::Paragraph::new("Family Labels").styled(style::Style::new().bold())),
            Box::new(elements::Paragraph::new(vt.family_labels.join(", ")))
        ]);
         // Limit behavior tags to prevent page overflow, e.g., take 10
         let tags = vt.behavior_tags.iter().take(15).cloned().collect::<Vec<_>>().join(", ");
         let _ = vt_table.push_row(vec![
            Box::new(elements::Paragraph::new("Behavior Tags").styled(style::Style::new().bold())),
            Box::new(elements::Paragraph::new(tags))
        ]);

        doc.push(vt_table);
        doc.push(elements::Break::new(2.0));
    }

    // --- REMNUX STATIC ANALYSIS ---
    if let Some(remnux) = &context.remnux_report {
        doc.push(elements::Paragraph::new("Static Analysis (Remnux)").styled(summary_style));
        doc.push(elements::Break::new(0.5));

        // remnux is a serde_json::Value representing MCPResponse { content: [ { type, text } ] }
        if let Some(content_array) = remnux.get("content").and_then(|c| c.as_array()) {
            for item in content_array {
                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                     // Check if it's empty or just whitespace
                     if text.trim().is_empty() { continue; }

                     // Use a monospaced-like look if possible, or just standard text
                     // genpdf doesn't have a built-in code block, so we use a Paragraph with specific style
                     // We might want to split by lines to handle formatting better, but Paragraph handles wrapping.
                     
                     let analysis_style = style::Style::new().with_font_size(9).with_color(style::Color::Rgb(60, 60, 60));
                     doc.push(elements::Paragraph::new(text).styled(analysis_style));
                     doc.push(elements::Break::new(0.5));
                }
            }
        } else {
             doc.push(elements::Paragraph::new("Reflective analysis data explicitly requested but main content block is missing or malformed.").styled(style::Style::new().italic().with_font_size(9)));
        }
        doc.push(elements::Break::new(2.0));
    }

    // --- MITRE ATT&CK MATRIX ---
    if !report.mitre_matrix.is_empty() {
        doc.push(elements::Paragraph::new("MITRE ATT&CK Matrix").styled(summary_style));
        doc.push(elements::Paragraph::new("Tactics and techniques identified during analysis, mapped to the MITRE framework.").styled(style::Style::new().italic().with_font_size(10).with_color(style::Color::Rgb(100, 100, 100))));
        doc.push(elements::Break::new(0.5));

        // Define standard tactic order for display
        let tactic_order = vec![
            "Reconnaissance", "Resource Development", "Initial Access", "Execution", 
            "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access", 
            "Discovery", "Lateral Movement", "Collection", "Command and Control", 
            "Exfiltration", "Impact"
        ];

        // Create a table for the matrix
        let mut matrix_table = elements::TableLayout::new(vec![3, 8]);
        matrix_table.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
        
        // Header
        let _ = matrix_table.push_row(vec![
            Box::new(elements::Paragraph::new("Tactic").styled(style::Style::new().bold())),
            Box::new(elements::Paragraph::new("Techniques & Evidence").styled(style::Style::new().bold())),
        ]);

        // Iterate through sorted tactics first, then any others
        let mut keys: Vec<&String> = report.mitre_matrix.keys().collect();
        // Custom sort: if in tactic_order, use index, else put at end
        keys.sort_by(|a, b| {
            let pos_a = tactic_order.iter().position(|&x| x.eq_ignore_ascii_case(a.replace("_", " ").as_str())).unwrap_or(999);
            let pos_b = tactic_order.iter().position(|&x| x.eq_ignore_ascii_case(b.replace("_", " ").as_str())).unwrap_or(999);
            pos_a.cmp(&pos_b)
        });

        for tactic in keys {
            if let Some(techniques) = report.mitre_matrix.get(tactic) {
                if techniques.is_empty() { continue; }
                
                let display_tactic = tactic.replace("_", " ").to_uppercase();
                let tactic_title = elements::Paragraph::new(display_tactic).styled(style::Style::new().bold().with_font_size(9));
                
                // Format techniques: "Name (ID): Evidence"
                let mut tech_content = elements::LinearLayout::vertical();
                for tech in techniques {
                    let header = format!("{} ({})", tech.name, tech.id);
                    tech_content.push(elements::Paragraph::new(header).styled(style::Style::new().bold().with_font_size(9)));
                    
                    if !tech.evidence.is_empty() {
                         for ev in &tech.evidence {
                              tech_content.push(elements::Paragraph::new(format!("- {}", ev)).styled(style::Style::new().italic().with_font_size(8).with_color(style::Color::Rgb(80, 80, 80))));
                         }
                    } else {
                         tech_content.push(elements::Paragraph::new("- No specific evidence cited.").styled(style::Style::new().italic().with_font_size(8).with_color(style::Color::Rgb(150, 150, 150))));
                    }
                    tech_content.push(elements::Break::new(0.5));
                }
                
                let _ = matrix_table.push_row(vec![
                    Box::new(tactic_title),
                    Box::new(tech_content),
                ]);
            }
        }
        
        doc.push(matrix_table);
        doc.push(elements::Break::new(2.0));
    }

    // --- PROCESS TREE ---
    doc.push(elements::Paragraph::new("Process Execution Tree").styled(summary_style));
    doc.push(elements::Paragraph::new("Hierarchical view of spawned processes during detonation.").styled(style::Style::new().italic().with_font_size(10).with_color(style::Color::Rgb(100,100,100))));
    doc.push(elements::Break::new(0.5));
    
    // Simple indentation logic based on sorting/parent relations could be complex here.
    // We will list them with basic details for now as the `context.processes` is flat.
    // Ideally we would build a tree, but a flat list with PPID reference is acceptable for V1.
    for proc in &context.processes {
        let indent = if proc.ppid > 0 { "  |-- " } else { "" };
        let text = format!("{} {} (PID: {})", indent, proc.image_name, proc.pid);
        let p = elements::Paragraph::new(text);
        
        // Highlight malware PIDs (only if they are numerical)
        let is_suspicious = report.behavioral_timeline.iter().any(|t| {
            t.related_pid == proc.pid
        });
        if is_suspicious {
            doc.push(p.styled(style::Style::new().bold().with_color(style::Color::Rgb(220, 38, 38))));
        } else {
            doc.push(p);
        }
    }
    doc.push(elements::Break::new(2.0));

    // --- BEHAVIORAL TIMELINE ---
    doc.push(elements::Paragraph::new("Behavioral Timeline").styled(summary_style));
    // Adjusted weights: Stage(3), Detail(10) to give maximum room for text
    let mut timeline_table = elements::TableLayout::new(vec![3, 10]); 
    timeline_table.set_cell_decorator(elements::FrameCellDecorator::new(true, true, false));
    
    // Header Row
    let _ = timeline_table.push_row(vec![
        Box::new(elements::Paragraph::new("Stage").styled(style::Style::new().bold())),
        Box::new(elements::Paragraph::new("Technical Context").styled(style::Style::new().bold())),
    ]);

    for event in &report.behavioral_timeline {
        let stage_style = style::Style::new().italic().with_font_size(9);
        let detail_text = format!("{}\n> {}", event.event_description, event.technical_context);
        
        let _ = timeline_table.push_row(vec![
            Box::new(elements::Paragraph::new(&event.stage).styled(stage_style)),
            Box::new(elements::Paragraph::new(detail_text).styled(style::Style::new().with_font_size(10))),
        ]);
    }
    doc.push(timeline_table);
    doc.push(elements::Break::new(2.0));

    // --- FORENSIC ARTIFACTS ---
    doc.push(elements::Paragraph::new("Forensic Artifacts & IOCs").styled(summary_style));
    doc.push(elements::Break::new(0.5));
    
    if !report.artifacts.c2_domains.is_empty() {
        doc.push(elements::Paragraph::new("Network Indicators").styled(style::Style::new().bold()));
        for c2 in &report.artifacts.c2_domains {
             doc.push(elements::Paragraph::new(format!("- [C2] {}", c2)).styled(style::Style::new().with_color(style::Color::Rgb(220, 38, 38))));
        }
        doc.push(elements::Break::new(0.5));
    }

    if !report.artifacts.c2_ips.is_empty() {
        doc.push(elements::Paragraph::new("C2 IP Addresses").styled(style::Style::new().bold()));
        for ip in &report.artifacts.c2_ips {
             doc.push(elements::Paragraph::new(format!("- [IP] {}", ip)).styled(style::Style::new().with_color(style::Color::Rgb(220, 38, 38))));
        }
        doc.push(elements::Break::new(0.5));
    }

    if !report.artifacts.dropped_files.is_empty() {
        doc.push(elements::Paragraph::new("Files Created").styled(style::Style::new().bold()));
        for f in &report.artifacts.dropped_files {
             doc.push(elements::Paragraph::new(format!("- {}", f)));
        }
        doc.push(elements::Break::new(0.5));
    }
    
    if !report.artifacts.command_lines.is_empty() {
        doc.push(elements::Paragraph::new("Suspicious Command Lines").styled(style::Style::new().bold()));
        for cmd in &report.artifacts.command_lines {
             // Create a code-block style look
             let mut p = elements::Paragraph::new(cmd);
             p.set_alignment(Alignment::Left); // Wrap text
             doc.push(p);
        }
    }

    // --- DETAILED ACTIVITY LOG ---
    doc.push(elements::Break::new(2.0));
    doc.push(elements::Paragraph::new("Detailed Activity Log").styled(summary_style));
    doc.push(elements::Paragraph::new("Comprehensive list of all observed system interactions.").styled(style::Style::new().italic().with_font_size(10)));
    doc.push(elements::Break::new(0.5));

    for proc in &context.processes {
        if proc.file_activity.is_empty() && proc.network_activity.is_empty() && proc.registry_mods.is_empty() {
            continue;
        }

        doc.push(elements::Paragraph::new(format!("Process: {} (PID: {})", proc.image_name, proc.pid))
            .styled(style::Style::new().bold().with_font_size(11)));

        // File Activity
        if !proc.file_activity.is_empty() {
            doc.push(elements::Paragraph::new("  File Operations:").styled(style::Style::new().bold().with_font_size(9)));
            for file in &proc.file_activity {
                doc.push(elements::Paragraph::new(format!("    - [{}]: {}", file.action, file.path)).styled(style::Style::new().with_font_size(9)));
            }
        }

        // Network Activity
        if !proc.network_activity.is_empty() {
             doc.push(elements::Paragraph::new("  Network Connections:").styled(style::Style::new().bold().with_font_size(9)));
            for net in &proc.network_activity {
                doc.push(elements::Paragraph::new(format!("    - [{}]: {} ({}) [Count: {}]", net.protocol, net.dest, net.port, net.count)).styled(style::Style::new().with_font_size(9)));
            }
        }

        // Registry Activity
        if !proc.registry_mods.is_empty() {
             doc.push(elements::Paragraph::new("  Registry Modifications:").styled(style::Style::new().bold().with_font_size(9)));
            for reg in &proc.registry_mods {
                doc.push(elements::Paragraph::new(format!("    - {}: {}", reg.key, reg.value_name)).styled(style::Style::new().with_font_size(9)));
            }
        }
        
        doc.push(elements::Break::new(1.0));
    }

    // Render to buffer
    let mut buffer = Vec::new();
    doc.render(&mut buffer)?;
    
    Ok(buffer)
}

// Legacy PDF Generator for AIReport (used by main.rs)
pub fn generate_pdf(task_id: String, report: AIReport) -> Result<Vec<u8>, genpdf::error::Error> {
    let font_dir = get_asset_path("assets/fonts");
    let font_family = genpdf::fonts::from_files(font_dir, "Roboto", None)
        .map_err(|e| {
             println!("[PDF] Failed to load font: {}", e);
             e
        })?;
        
    let mut doc = genpdf::Document::new(font_family);
    doc.set_title("VooDooBox AI Analysis Report");

    let mut decorator = genpdf::SimplePageDecorator::new();
    decorator.set_margins(10);
    doc.set_page_decorator(decorator);

    doc.push(elements::Paragraph::new("AI ANALYSIS REPORT")
        .aligned(Alignment::Right)
        .styled(style::Style::new().bold().with_font_size(18)));
    doc.push(elements::Break::new(1.5));

    doc.push(elements::Paragraph::new(format!("Task ID: {}", task_id)));
    doc.push(elements::Paragraph::new(format!("Threat Level: {}", report.threat_level)));
    doc.push(elements::Paragraph::new(format!("Risk Score: {}/100", report.risk_score)));
    doc.push(elements::Break::new(1.0));

    doc.push(elements::Paragraph::new("Summary").styled(style::Style::new().bold().with_font_size(14)));
    doc.push(elements::Paragraph::new(report.summary));
    doc.push(elements::Break::new(1.0));

    if !report.suspicious_pids.is_empty() {
        doc.push(elements::Paragraph::new("Suspicious Processes").styled(style::Style::new().bold()));
        for pid in report.suspicious_pids {
            doc.push(elements::Paragraph::new(format!("- PID: {}", pid)));
        }
        doc.push(elements::Break::new(1.0));
    }

    if !report.mitre_tactics.is_empty() {
        doc.push(elements::Paragraph::new("MITRE ATT&CK Tactics").styled(style::Style::new().bold()));
        for tactic in report.mitre_tactics {
            doc.push(elements::Paragraph::new(format!("- {}", tactic)));
        }
        doc.push(elements::Break::new(1.0));
    }

    if !report.recommendations.is_empty() {
        doc.push(elements::Paragraph::new("Recommendations").styled(style::Style::new().bold()));
        for rec in report.recommendations {
            doc.push(elements::Paragraph::new(format!("- {}", rec)));
        }
    }

    let mut buffer = Vec::new();
    doc.render(&mut buffer)?;
    Ok(buffer)
}
