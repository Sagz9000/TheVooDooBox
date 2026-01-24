/* ###
 * IP: GHIDRA
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
//Export Bookmarks
//@category AI

import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Bookmark;
import ghidra.program.model.listing.BookmarkManager;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

public class GetBookmarks extends GhidraScript {

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("Usage: GetBookmarks <output_file>");
            return;
        }
        String outputPath = args[0];

        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        try {
            List<Map<String, String>> bookmarksList = new ArrayList<>();
            BookmarkManager bm = currentProgram.getBookmarkManager();
            Iterator<Bookmark> it = bm.getBookmarksIterator();
            
            int count = 0;
            while(it.hasNext() && count < 500) {
                 Bookmark bmItem = it.next();
                 Map<String, String> bObj = new HashMap<>();
                 bObj.put("address", bmItem.getAddress().toString());
                 bObj.put("type", bmItem.getTypeString());
                 bObj.put("category", bmItem.getCategory());
                 bObj.put("comment", bmItem.getComment());
                 
                 bookmarksList.add(bObj);
                 count++;
            }

            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                gson.toJson(bookmarksList, writer);
            }
            println("JSON written to " + outputPath);
        } catch (Exception e) {
            Map<String, String> err = new HashMap<>();
            err.put("error", e.toString());
            try (java.io.FileWriter writer = new java.io.FileWriter(outputPath)) {
                 gson.toJson(err, writer);
            }
        }
    }
}
